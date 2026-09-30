import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { API_URL, asUser, signIn, withIdentityLock } from './auth.js';
import { acquireGlobalThresholds } from './global-thresholds.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-K Part B — `lms_tutor` end to end through the DEPLOYED Edge Function.
 *
 * `lms-tutor.test.ts` drives `answerLessonQuestion` with a scripted rpc and model. **This file proves
 * the database agrees**: a real GoTrue sign-in, a real `POST` to the gateway, and the function's own
 * Deno process calling the RPCs as that learner.
 *
 * **The assertion that matters is not a message.** The tutor's claim is that a learner may only be
 * taught a lesson they are ENROLLED on, from a PUBLISHED version — and that both guardrails fire
 * before any provider call. Both are read out of state:
 *
 *   * `ai_requests.model_provider IS NULL` — reachable only if `generate` never ran, with a positive
 *     control so a null cannot mean a broken insert;
 *   * `lms_tutor_lesson_context` refusing `42501` for a lesson the learner is not enrolled on, with a
 *     positive control on one they are.
 *
 * **Fixtures are COMMITTED, not rolled back**, because the Edge Function reads from its own
 * connection. Everything is namespaced by `runId`; `app_thresholds` is append-only so its rows are
 * reverted by inserting later ones that say they are test artefacts.
 */

const reachable = await requireDatabase();
const FUNCTION_URL = `${API_URL}/functions/v1/ai-gateway`;

const functionIsServed = await (async (): Promise<boolean> => {
  if (!reachable) return false;
  try {
    const response = await fetch(FUNCTION_URL, { method: 'POST' });
    return response.status > 0;
  } catch {
    return false;
  }
})();

if (reachable && !functionIsServed) {
  console.warn(
    `No Edge Function at ${FUNCTION_URL} — lms_tutor gateway tests will be skipped.\n` +
      "Run 'pnpm --filter @fieldforce/core build && pnpm functions:serve' first if you meant to run them.",
  );
}

const live = reachable && functionIsServed;

let world: FixtureWorld;
let releaseGlobalThresholds: (() => Promise<void>) | null = null;
let runId = '';
let promptVersionId: string;
let enrolledLessonId = '';
/** A published lesson in the same organisation the MR is NOT enrolled on. */
let unenrolledLessonId = '';
/** A published lesson in the RIVAL organisation. */
let rivalLessonId = '';
let mrToken: string;

const makeReviewer = async (db: Client, organisationId: string): Promise<string> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, email, aud, role)
       values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `tutor-reviewer-${id.slice(0, 8)}@example.test`],
    );
    await db.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'Tutor Reviewer', 'admin', null, true, $2)`,
      [id, organisationId],
    );
    return id;
  });

const asRpcUser = async (
  db: Client,
  profile: ProfileLike,
  sql: string,
  params: unknown[],
): Promise<void> => {
  await db.query('begin');
  try {
    await asUser(db, profile);
    await db.query(sql, params);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
};

const setThreshold = async (
  db: Client,
  key: string,
  value: string,
  note: string,
): Promise<void> => {
  await db.query(
    `insert into public.app_thresholds (key, value, scope, note, effective_from)
     values ($1, $2::jsonb, 'global', $3, now())`,
    [key, value, note],
  );
};

/**
 * One published course with one lesson, authored by that organisation's admin.
 *
 * The inserts send junk organisation ids on purpose, mirroring `lms-core.spec.ts`: the triggers
 * derive the organisation from the course, and sending a wrong one proves they do.
 */
const publishedLesson = async (
  db: Client,
  admin: ProfileLike,
  title: string,
  body: string,
): Promise<{ versionId: string; lessonId: string }> => {
  const courseId = randomUUID();
  const versionId = randomUUID();
  const moduleId = randomUUID();
  const lessonId = randomUUID();
  await db.query('begin');
  try {
    await asUser(db, admin);
    await db.query(`insert into public.courses (id, title) values ($1, $2)`, [
      courseId,
      `${title} course ${runId}`,
    ]);
    await db.query(
      `insert into public.course_versions (id, course_id, organisation_id, title)
       values ($1, $2, $3, $4)`,
      [versionId, courseId, randomUUID(), `${title} v1`],
    );
    await db.query(
      `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
       values ($1, $2, $3, 1, 'Module one')`,
      [moduleId, versionId, randomUUID()],
    );
    await db.query(
      `insert into public.lessons
         (id, module_id, course_version_id, organisation_id, position, title, body)
       values ($1, $2, $3, $4, 1, $5, $6)`,
      [lessonId, moduleId, randomUUID(), randomUUID(), title, body],
    );
    await db.query(`select public.publish_course_version($1)`, [versionId]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return { versionId, lessonId };
};

beforeAll(async () => {
  if (!live) return;
  releaseGlobalThresholds = await acquireGlobalThresholds();
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);

  await withClient(async (db) => {
    const reviewerId = await makeReviewer(db, world.organisationId);
    const reviewer: ProfileLike = {
      id: reviewerId,
      role: 'admin',
      territoryId: null,
      isActive: true,
    };

    await setThreshold(
      db,
      'ai_feature_enabled:lms_tutor',
      'true',
      `W1-K test artefact (${runId}). NOT a product decision: #5 is open and no vendor exists. Reverted in afterAll.`,
    );
    await setThreshold(
      db,
      'ai_daily_requests_per_user',
      '50',
      `W1-K test artefact (${runId}). NOT a product decision. Reverted in afterAll.`,
    );

    // The lesson the MR IS enrolled on.
    const enrolled = await publishedLesson(
      db,
      world.users.admin,
      `Enrolled ${runId}`,
      'Interstitial cystitis is a long lasting bladder condition. This lesson covers how to open the conversation.',
    );
    enrolledLessonId = enrolled.lessonId;

    // **ENROLMENT is created by the LEARNER calling `start_course_version`, not by `assign_course`.**
    // The first version of this fixture called `assign_course` as the admin and stopped there, which
    // creates a `course_assignments` row and no enrolment — so the tutor correctly refused the lesson
    // the learner was supposed to be enrolled on. **The positive control below is what caught it:**
    // without it, three 403s would have read as a working tenant boundary rather than a broken
    // fixture. Both calls are made here because both happen in the product: an admin assigns, the
    // learner starts.
    const enrolledCourseId = (
      await db.query<{ course_id: string }>(
        `select course_id from public.course_versions where id = $1`,
        [enrolled.versionId],
      )
    ).rows[0]?.course_id;
    await asRpcUser(db, world.users.admin, `select public.assign_course($1, $2, null)`, [
      enrolledCourseId,
      world.users.puneMr.id,
    ]);
    await asRpcUser(db, world.users.puneMr, `select public.start_course_version($1)`, [
      enrolled.versionId,
    ]);

    // A published lesson in the SAME organisation the MR is NOT enrolled on.
    const unenrolled = await publishedLesson(
      db,
      world.users.admin,
      `Unenrolled ${runId}`,
      'A different lesson the learner was never assigned.',
    );
    unenrolledLessonId = unenrolled.lessonId;

    // A published lesson in the RIVAL organisation.
    const rival = await publishedLesson(
      db,
      world.users.rivalAdmin,
      `Rival ${runId}`,
      'A rival company training lesson.',
    );
    rivalLessonId = rival.lessonId;

    // `lms_tutor`'s OWN approved prompt, with ITS output schema name.
    promptVersionId = randomUUID();
    await db.query(
      `insert into public.ai_prompt_versions
         (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
          created_by_user_id)
       values ($1, $2, 'lms_tutor',
               (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
                 where organisation_id = $2 and feature = 'lms_tutor'),
               $3, 'LmsTutorOutputSchema', $4)`,
      [
        promptVersionId,
        world.organisationId,
        'You explain one training lesson to a learner.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_ai_prompt_version($1)`, [
      promptVersionId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_ai_prompt_version($1, $2)`, [
      promptVersionId,
      `W1-K: lms_tutor prompt for a local test. Stub provider, no vendor.`,
    ]);
  });

  const { accessToken } = await signIn(world.users.puneMr.email, world.users.puneMr.password);
  mrToken = accessToken;
}, 180_000);

afterAll(async () => {
  try {
    if (!live || runId === '') return;
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:lms_tutor',
        'false',
        `W1-K revert (${runId}). The flag returns to its shipped state: OFF.`,
      );
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        'null',
        `W1-K revert (${runId}). Restores the UNSET state: an unlimited allowance is never the default.`,
      );
      // `ai_requests`, `course_enrolments` and `lesson_completions` are append-only and refuse
      // DELETE unconditionally — W1-J C1 measured all 14 tables the suites touch. Nothing is
      // attempted here; `pnpm db:reset` clears the run's rows.
    });
  } finally {
    await releaseGlobalThresholds?.();
    releaseGlobalThresholds = null;
  }
});

const ask = async (
  lessonId: string,
  question: string,
  opts: { token?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === null ? {} : { Authorization: `Bearer ${opts.token ?? mrToken}` }),
    },
    body: JSON.stringify({ feature: 'lms_tutor', lessonId, question }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const auditRow = async (requestId: string) =>
  withClient(async (db) => {
    const { rows } = await db.query<{
      feature: string;
      status: string;
      model_provider: string | null;
      model_name: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      flags: string[];
      prompt_version_id: string;
      user_id: string;
      organisation_id: string;
    }>(
      `select feature, status, model_provider, model_name, input_tokens, output_tokens, flags,
              prompt_version_id, user_id, organisation_id
         from public.ai_requests where id = $1`,
      [requestId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`no ai_requests row for ${requestId}`);
    return row;
  });

// ---------------------------------------------------------------------------

describe.skipIf(!live)('W1-K B5 — lms_tutor end to end through the Edge Function', () => {
  it('a learner reaches the function, the database picks the prompt, and the call is audited', async () => {
    const { status, body } = await ask(enrolledLessonId, 'what does long lasting mean here');
    expect(status, JSON.stringify(body)).toBe(200);

    // The stub answers `groundedInLesson: false`, so the flow returns the referral. That is the stub
    // being honest; the audit is what this test is about.
    expect(body['kind']).toBe('not_in_lesson');
    expect(typeof body['requestId']).toBe('string');

    const row = await auditRow(body['requestId'] as string);
    expect(row.prompt_version_id).toBe(promptVersionId);
    expect(row.feature).toBe('lms_tutor');
    expect(row.status).toBe('completed');
    expect(row.model_provider).toBe('stub');
    expect(row.model_name).not.toBeNull();
    expect(row.input_tokens).not.toBeNull();
    expect(row.output_tokens).not.toBeNull();
    expect(row.user_id).toBe(world.users.puneMr.id);
    expect(row.organisation_id).toBe(world.organisationId);
  });

  it('refuses with no bearer token', async () => {
    const { status } = await ask(enrolledLessonId, 'what does this mean', { token: null });
    expect(status).toBe(401);
  });

  it('refuses a call with no lessonId, before any control-plane work', async () => {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${mrToken}` },
      body: JSON.stringify({ feature: 'lms_tutor', question: 'what does this mean' }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>)['code']).toBe('22023');
  });

  it('45011 arrives as 403 when lms_tutor is switched off', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:lms_tutor',
        'false',
        `W1-K (${runId}): off, to prove 45011 maps to 403.`,
      );
    });
    try {
      const { status, body } = await ask(enrolledLessonId, 'what does this mean');
      expect(status).toBe(403);
      expect(body['code']).toBe('45011');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_feature_enabled:lms_tutor',
          'true',
          `W1-K (${runId}): back on for the remaining tests.`,
        );
      });
    }
  });

  it('45012 arrives as 429 when the allowance is spent', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        '0',
        `W1-K (${runId}): allowance spent, to prove 45012 maps to 429.`,
      );
    });
    try {
      const { status, body } = await ask(enrolledLessonId, 'what does this mean');
      expect(status).toBe(429);
      expect(body['code']).toBe('45012');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_daily_requests_per_user',
          '50',
          `W1-K (${runId}): allowance restored.`,
        );
      });
    }
  });
});

describe.skipIf(!live)('W1-K B3 — both guardrails fire BEFORE any provider call', () => {
  it('a question naming a patient is blocked with NO provider recorded', async () => {
    const { body } = await ask(
      enrolledLessonId,
      'patient Meena Kumari, 42, has bladder pain — what does the lesson say',
    );
    expect(body['kind']).toBe('patient_specific');
    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    expect(row.model_provider, 'NO provider call happened').toBeNull();
    expect(row.input_tokens).toBeNull();
    expect(row.flags).toContain('patient_identifier_detected');
  });

  it('a clinical question is blocked with NO provider recorded', async () => {
    const { body } = await ask(
      enrolledLessonId,
      'is 400mg twice daily normal for interstitial cystitis',
    );
    expect(body['kind']).toBe('not_in_lesson');
    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    expect(row.model_provider, 'NO provider call happened').toBeNull();
  });

  it('POSITIVE CONTROL: an ordinary lesson question DOES reach the provider', async () => {
    const { body } = await ask(enrolledLessonId, 'what does long lasting mean here');
    const row = await auditRow(body['requestId'] as string);
    expect(row.model_provider, 'the provider IS reachable on a clean question').toBe('stub');
    expect(row.input_tokens).not.toBeNull();
  });
});

describe.skipIf(!live)('W1-K B6 — the lesson scope, two-sided', () => {
  it('refuses a published lesson in the same organisation the learner is NOT enrolled on', async () => {
    const { status, body } = await ask(unenrolledLessonId, 'what does this lesson say');
    // 42501 from `lms_tutor_lesson_context`, surfaced by the gateway as 403.
    expect(status).toBe(403);
    expect(body['code']).toBe('42501');
  });

  it('refuses a RIVAL organisation’s published lesson', async () => {
    const { status, body } = await ask(rivalLessonId, 'what does this lesson say');
    expect(status).toBe(403);
    expect(body['code']).toBe('42501');
  });

  it('POSITIVE CONTROL: the enrolled lesson IS reachable, so the refusals mean scope', async () => {
    // Without this, three 403s could equally mean the function is broken for every lesson.
    const { status, body } = await ask(enrolledLessonId, 'what does long lasting mean here');
    expect(status).toBe(200);
    expect(body['requestId']).toBeDefined();
  });

  it('mr_chat’s flag does not switch lms_tutor on — four features, four flags', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:lms_tutor',
        'false',
        `W1-K (${runId}): lms_tutor OFF while mr_chat is ON.`,
      );
      await setThreshold(
        db,
        'ai_feature_enabled:mr_chat',
        'true',
        `W1-K test artefact (${runId}). Reverted below.`,
      );
    });
    try {
      const { status, body } = await ask(enrolledLessonId, 'what does this mean');
      expect(status).toBe(403);
      expect(body['code']).toBe('45011');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_feature_enabled:mr_chat',
          'false',
          `W1-K revert (${runId}). mr_chat returns to OFF.`,
        );
        await setThreshold(
          db,
          'ai_feature_enabled:lms_tutor',
          'true',
          `W1-K (${runId}): lms_tutor back on.`,
        );
      });
    }
  });

  it('anon cannot execute lms_tutor_lesson_context at all', async () => {
    const allowed = await withClient(async (db) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege('anon', 'public.lms_tutor_lesson_context(uuid)', 'execute') as ok`,
      );
      return rows[0]?.ok ?? true;
    });
    expect(allowed).toBe(false);
  });
});
