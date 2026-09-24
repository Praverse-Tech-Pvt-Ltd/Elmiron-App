import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  AssignCourseResponseSchema,
  CancelCourseAssignmentResponseSchema,
  CompleteLessonResponseSchema,
  PublishCourseVersionResponseSchema,
  RetireCourseVersionResponseSchema,
  StartCourseVersionResponseSchema,
} from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * AI-B2 — LMS core (`20260924000500_lms_core.sql`).
 *
 * The property the migration is built around: **a published version never changes, and what a
 * learner completed is always the exact text they read.** Most of this file is that property
 * attacked from each side — the version row, its modules, its lessons, its status, and the
 * learning records hanging off it.
 *
 * Every refusal has its positive control through the same path: the edit that is refused after
 * publishing is first shown to succeed while the version is a draft; the assignment refused for a
 * user outside the manager's subtree is shown to succeed for one inside it.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** Runs `sql`; returns the SQLSTATE it failed with, or null. Leaves the transaction usable. */
const sqlstate = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint probe');
    return (error as { code?: string }).code ?? 'unknown';
  }
};

const rpc = async <T = Record<string, unknown>>(
  client: Client,
  fn: string,
  args: unknown[],
): Promise<T> => {
  const placeholders = args.map((_, i) => `$${String(i + 1)}`).join(', ');
  const r = await client.query<{ result: T }>(
    `select public.${fn}(${placeholders}) as result`,
    args,
  );
  return r.rows[0]?.result as T;
};

interface Draft {
  courseId: string;
  versionId: string;
  moduleId: string;
  lessonIds: string[];
}

/** A course with one draft version, one module and `lessons` lessons — as the given admin. */
const draftCourse = async (
  client: Client,
  admin: FixtureUser,
  opts: { lessons?: number; courseId?: string; marketId?: string | null } = {},
): Promise<Draft> => {
  await asUser(client, admin);
  const courseId = opts.courseId ?? randomUUID();
  if (opts.courseId === undefined) {
    await client.query(`insert into public.courses (id, title) values ($1, 'Probe course')`, [
      courseId,
    ]);
  }
  const versionId = randomUUID();
  await client.query(
    `insert into public.course_versions (id, course_id, organisation_id, title, market_id)
     values ($1, $2, $3, 'Probe version', $4)`,
    // The organisation sent here is ignored: the trigger derives it from the course.
    [versionId, courseId, randomUUID(), opts.marketId ?? null],
  );
  const moduleId = randomUUID();
  await client.query(
    `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
     values ($1, $2, $3, 1, 'Module one')`,
    [moduleId, versionId, randomUUID()],
  );
  const lessonIds: string[] = [];
  for (let i = 1; i <= (opts.lessons ?? 2); i++) {
    const id = randomUUID();
    await client.query(
      `insert into public.lessons (id, module_id, course_version_id, organisation_id, position, title, body)
       values ($1, $2, $3, $4, $5, $6, 'Synthetic training text. Describes nobody.')`,
      [id, moduleId, randomUUID(), randomUUID(), i, `Lesson ${String(i)}`],
    );
    lessonIds.push(id);
  }
  return { courseId, versionId, moduleId, lessonIds };
};

const publishedCourse = async (
  client: Client,
  admin: FixtureUser,
  opts: { lessons?: number } = {},
): Promise<Draft> => {
  const d = await draftCourse(client, admin, opts);
  await rpc(client, 'publish_course_version', [d.versionId]);
  return d;
};

const visible = async (client: Client, table: string, id: string): Promise<number> => {
  const r = await client.query(`select 1 from public.${table} where id = $1`, [id]);
  return r.rowCount ?? 0;
};

describe.skipIf(!reachable)('AI-B2 — authoring and the draft', () => {
  it('a version is born a draft, numbered by the server, in the course’s organisation', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftCourse(client, world.users.admin);
      // A second version, sent with a status and a number of its own choosing.
      const v2 = randomUUID();
      await client.query(
        `insert into public.course_versions (id, course_id, title, version_number, status)
         values ($1, $2, 'Second', 99, 'published')`,
        [v2, d.courseId],
      );
      const rows = await client.query<{
        id: string;
        version_number: number;
        status: string;
        organisation_id: string;
        published_at: string | null;
      }>(
        `select id, version_number, status, organisation_id, published_at
           from public.course_versions where course_id = $1 order by version_number`,
        [d.courseId],
      );
      expect(rows.rows.map((r) => [r.version_number, r.status, r.published_at])).toEqual([
        [1, 'draft', null],
        [2, 'draft', null],
      ]);
      for (const r of rows.rows) expect(r.organisation_id).toBe(world.organisationId);
      const lesson = await client.query<{ organisation_id: string; course_version_id: string }>(
        `select organisation_id, course_version_id from public.lessons where id = $1`,
        [d.lessonIds[0]],
      );
      expect(lesson.rows[0]).toEqual({
        organisation_id: world.organisationId,
        course_version_id: d.versionId,
      });
    });
  });

  it('a draft is the admin’s alone: an MR cannot see it, nor write any content', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftCourse(client, world.users.admin);
      expect(await visible(client, 'course_versions', d.versionId), 'admin sees draft').toBe(1);
      expect(await visible(client, 'lessons', d.lessonIds[0] ?? ''), 'admin sees lesson').toBe(1);

      await asUser(client, world.users.puneMr);
      expect(await visible(client, 'course_versions', d.versionId)).toBe(0);
      expect(await visible(client, 'course_modules', d.moduleId)).toBe(0);
      expect(await visible(client, 'lessons', d.lessonIds[0] ?? '')).toBe(0);
      // The course NAME is visible to the organisation; its content is not.
      expect(await visible(client, 'courses', d.courseId)).toBe(1);

      expect(
        await sqlstate(client, `insert into public.courses (title) values ('MR course')`),
      ).toBe('42501');
      expect(
        await sqlstate(
          client,
          `insert into public.lessons (module_id, course_version_id, organisation_id, position, title, body)
           values ($1, $2, $3, 9, 'MR lesson', 'x')`,
          [d.moduleId, d.versionId, world.organisationId],
        ),
      ).toBe('42501');
    });
  });

  it('publishing needs an admin of the organisation, and at least one lesson', async () => {
    await inRolledBackTransaction(async (client) => {
      const empty = await draftCourse(client, world.users.admin, { lessons: 0 });
      expect(
        await sqlstate(client, 'select public.publish_course_version($1)', [empty.versionId]),
      ).toBe('22023');

      const d = await draftCourse(client, world.users.admin);
      for (const user of [world.users.puneMr, world.users.westManager, world.users.rivalAdmin]) {
        await asUser(client, user);
        expect(
          await sqlstate(client, 'select public.publish_course_version($1)', [d.versionId]),
          user.role,
        ).toBe('42501');
      }

      await asUser(client, world.users.admin);
      const out = await rpc<{ status: string; publishedAt: string }>(
        client,
        'publish_course_version',
        [d.versionId],
      );
      expect(out.status).toBe('published');
      expect(out.publishedAt).toBeTruthy();

      await asUser(client, world.users.puneMr);
      expect(await visible(client, 'lessons', d.lessonIds[0] ?? ''), 'MR now sees it').toBe(1);
    });
  });
});

describe.skipIf(!reachable)('AI-B2 — a published version never changes', () => {
  it('content that is editable in draft is refused once published', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftCourse(client, world.users.admin);
      const lessonId = d.lessonIds[0] ?? '';

      // Positive control: every edit below succeeds while the version is a draft.
      expect(
        await sqlstate(client, `update public.lessons set body = 'Draft edit' where id = $1`, [
          lessonId,
        ]),
      ).toBeNull();
      expect(
        await sqlstate(client, `update public.course_versions set title = 'Draft' where id = $1`, [
          d.versionId,
        ]),
      ).toBeNull();

      await rpc(client, 'publish_course_version', [d.versionId]);

      const attempts: [string, string, unknown[]][] = [
        ['edit a lesson', `update public.lessons set body = 'Rewritten' where id = $1`, [lessonId]],
        ['delete a lesson', `delete from public.lessons where id = $1`, [lessonId]],
        [
          'add a lesson',
          `insert into public.lessons (module_id, course_version_id, organisation_id, position, title, body)
           values ($1, $2, $3, 9, 'Late', 'Late')`,
          [d.moduleId, d.versionId, world.organisationId],
        ],
        [
          'rename a module',
          `update public.course_modules set title = 'Renamed' where id = $1`,
          [d.moduleId],
        ],
        [
          'retitle the version',
          `update public.course_versions set title = 'Renamed' where id = $1`,
          [d.versionId],
        ],
      ];
      for (const [what, sql, params] of attempts) {
        expect(await sqlstate(client, sql, params), what).toBe('23514');
      }
      // Status is not in the column grant: it moves only through the RPCs.
      expect(
        await sqlstate(client, `update public.course_versions set status = 'draft' where id = $1`, [
          d.versionId,
        ]),
      ).toBe('42501');

      const body = await client.query<{ body: string }>(
        `select body from public.lessons where id = $1`,
        [lessonId],
      );
      expect(body.rows[0]?.body).toBe('Draft edit');
    });
  });

  it('even the owner cannot rewrite a published lesson or un-retire a version', async () => {
    // RLS and grants out of the way: the triggers are the only thing standing.
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await rpc(client, 'retire_course_version', [d.versionId]);
      await asOwner(client, async () => {
        expect(
          await sqlstate(client, `update public.lessons set body = 'Owner' where id = $1`, [
            d.lessonIds[0],
          ]),
        ).toBe('23514');
        expect(
          await sqlstate(
            client,
            `update public.course_versions set status = 'published' where id = $1`,
            [d.versionId],
          ),
        ).toBe('23514');
      });
    });
  });

  it('publishing a new version retires the old one for the same market, and only that', async () => {
    await inRolledBackTransaction(async (client) => {
      const v1 = await publishedCourse(client, world.users.admin);
      // A market-specific version of the same course, published alongside.
      await asUser(client, world.users.admin);
      const marketId = randomUUID();
      await client.query(
        `insert into public.markets (id, country_code, name) values ($1, 'AE', 'UAE')`,
        [marketId],
      );
      const uae = await draftCourse(client, world.users.admin, { courseId: v1.courseId, marketId });
      await rpc(client, 'publish_course_version', [uae.versionId]);

      const v2 = await draftCourse(client, world.users.admin, { courseId: v1.courseId });
      const out = await rpc<{ retiredCourseVersionIds: string[] }>(
        client,
        'publish_course_version',
        [v2.versionId],
      );
      expect(out.retiredCourseVersionIds).toEqual([v1.versionId]);

      const statuses = await client.query<{ id: string; status: string }>(
        `select id, status from public.course_versions where course_id = $1`,
        [v1.courseId],
      );
      const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
      expect(byId[v1.versionId]).toBe('retired');
      expect(byId[uae.versionId], 'another market is untouched').toBe('published');
      expect(byId[v2.versionId]).toBe('published');
    });
  });
});

describe.skipIf(!reachable)('AI-B2 — learning', () => {
  it('an MR starts a course, completes it lesson by lesson, and the server stamps completion once', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await asUser(client, world.users.puneMr);

      const e = await rpc<{ id: string; completedAt: string | null }>(
        client,
        'start_course_version',
        [d.versionId],
      );
      const again = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);
      expect(again.id, 'starting twice resumes').toBe(e.id);

      const first = await rpc<{ courseCompletedAt: string | null; lessonsCompleted: number }>(
        client,
        'complete_lesson',
        [e.id, d.lessonIds[0]],
      );
      expect(first).toMatchObject({ courseCompletedAt: null, lessonsCompleted: 1 });

      const last = await rpc<{ courseCompletedAt: string | null; lessonsCompleted: number }>(
        client,
        'complete_lesson',
        [e.id, d.lessonIds[1]],
      );
      expect(last.lessonsCompleted).toBe(2);
      expect(last.courseCompletedAt).toBeTruthy();

      // Repeating the last lesson neither duplicates it nor moves the completion time.
      const repeat = await rpc<{ courseCompletedAt: string | null; lessonsCompleted: number }>(
        client,
        'complete_lesson',
        [e.id, d.lessonIds[1]],
      );
      expect(repeat).toMatchObject({
        lessonsCompleted: 2,
        courseCompletedAt: last.courseCompletedAt,
      });
    });
  });

  it('a retired version admits no new learner, and lets an existing one finish', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await asUser(client, world.users.puneMr);
      const e = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);

      await asUser(client, world.users.admin);
      await rpc(client, 'retire_course_version', [d.versionId]);

      await asUser(client, world.users.nagpurMr);
      expect(await sqlstate(client, 'select public.start_course_version($1)', [d.versionId])).toBe(
        '22023',
      );

      await asUser(client, world.users.puneMr);
      expect(await visible(client, 'lessons', d.lessonIds[0] ?? ''), 'still readable').toBe(1);
      expect(
        await sqlstate(client, 'select public.complete_lesson($1, $2)', [e.id, d.lessonIds[0]]),
      ).toBeNull();
    });
  });

  it('refuses a draft, another organisation’s course, a foreign lesson, and someone else’s enrolment', async () => {
    await inRolledBackTransaction(async (client) => {
      const draft = await draftCourse(client, world.users.admin);
      const d = await publishedCourse(client, world.users.admin);
      const other = await publishedCourse(client, world.users.admin);
      const rival = await publishedCourse(client, world.users.rivalAdmin);

      await asUser(client, world.users.puneMr);
      expect(
        await sqlstate(client, 'select public.start_course_version($1)', [draft.versionId]),
        'a draft',
      ).toBe('22023');
      expect(
        await sqlstate(client, 'select public.start_course_version($1)', [rival.versionId]),
        'another organisation',
      ).toBe('42501');

      const e = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);
      expect(
        await sqlstate(client, 'select public.complete_lesson($1, $2)', [e.id, other.lessonIds[0]]),
        'a lesson from another course',
      ).toBe('22023');

      await asUser(client, world.users.nagpurMr);
      expect(
        await sqlstate(client, 'select public.complete_lesson($1, $2)', [e.id, d.lessonIds[0]]),
        'someone else’s enrolment',
      ).toBe('42501');
    });
  });

  it('learning records are written only by the RPCs, and completions are append-only', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await asUser(client, world.users.puneMr);
      const e = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);
      await rpc(client, 'complete_lesson', [e.id, d.lessonIds[0]]);

      expect(
        await sqlstate(
          client,
          `insert into public.course_enrolments (organisation_id, user_id, course_version_id)
           values ($1, $2, $3)`,
          [world.organisationId, world.users.puneMr.id, d.versionId],
        ),
      ).toBe('42501');
      expect(
        await sqlstate(
          client,
          `update public.course_enrolments set completed_at = now() where id = $1`,
          [e.id],
        ),
      ).toBe('42501');

      await asOwner(client, async () => {
        expect(
          await sqlstate(client, `delete from public.lesson_completions where enrolment_id = $1`, [
            e.id,
          ]),
        ).toBe('23001');
        expect(
          await sqlstate(
            client,
            `update public.lesson_completions set completed_at = now() where enrolment_id = $1`,
            [e.id],
          ),
        ).toBe('23001');
        expect(
          await sqlstate(client, `delete from public.course_enrolments where id = $1`, [e.id]),
        ).toBe('23001');
      });
    });
  });
});

describe.skipIf(!reachable)('AI-B2 — assignment and who sees progress', () => {
  it('a manager assigns inside their subtree only; an MR assigns nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await asUser(client, world.users.westManager);

      const a = await rpc<{ id: string }>(client, 'assign_course', [
        d.courseId,
        world.users.puneMr.id,
        '2026-12-31',
      ]);
      const again = await rpc<{ id: string }>(client, 'assign_course', [
        d.courseId,
        world.users.puneMr.id,
        null,
      ]);
      expect(again.id, 'assigning twice returns the live assignment').toBe(a.id);

      expect(
        await sqlstate(client, 'select public.assign_course($1, $2, null)', [
          d.courseId,
          world.users.southMr.id,
        ]),
        'outside the subtree',
      ).toBe('42501');

      await asUser(client, world.users.puneMr);
      expect(
        await sqlstate(client, 'select public.assign_course($1, $2, null)', [
          d.courseId,
          world.users.nagpurMr.id,
        ]),
        'an MR',
      ).toBe('42501');
    });
  });

  it('a course with nothing published cannot be assigned', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftCourse(client, world.users.admin);
      expect(
        await sqlstate(client, 'select public.assign_course($1, $2, null)', [
          d.courseId,
          world.users.puneMr.id,
        ]),
      ).toBe('22023');
    });
  });

  it('an assignment is cancelled once, and stays as history', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      const a = await rpc<{ id: string }>(client, 'assign_course', [
        d.courseId,
        world.users.puneMr.id,
        null,
      ]);
      await rpc(client, 'cancel_course_assignment', [a.id]);
      expect(await sqlstate(client, 'select public.cancel_course_assignment($1)', [a.id])).toBe(
        '22023',
      );
      expect(await visible(client, 'course_assignments', a.id)).toBe(1);

      // A fresh assignment is allowed after cancellation: the uniqueness is on LIVE ones.
      const b = await rpc<{ id: string }>(client, 'assign_course', [
        d.courseId,
        world.users.puneMr.id,
        null,
      ]);
      expect(b.id).not.toBe(a.id);
    });
  });

  it('progress is seen by the learner, their manager and admin — not a peer, a sibling manager or another company', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      const a = await rpc<{ id: string }>(client, 'assign_course', [
        d.courseId,
        world.users.puneMr.id,
        null,
      ]);
      await asUser(client, world.users.puneMr);
      const e = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);
      await rpc(client, 'complete_lesson', [e.id, d.lessonIds[0]]);

      const cases: [FixtureUser, number][] = [
        [world.users.puneMr, 1],
        [world.users.westManager, 1],
        [world.users.admin, 1],
        [world.users.nagpurMr, 0],
        [world.users.southManager, 0],
        [world.users.rivalAdmin, 0],
      ];
      for (const [user, expected] of cases) {
        await asUser(client, user);
        const label = `${user.role} ${user.id.slice(0, 8)}`;
        expect(await visible(client, 'course_enrolments', e.id), `${label} enrolment`).toBe(
          expected,
        );
        expect(await visible(client, 'course_assignments', a.id), `${label} assignment`).toBe(
          expected,
        );
        const c = await client.query(
          `select 1 from public.lesson_completions where enrolment_id = $1`,
          [e.id],
        );
        expect(c.rowCount, `${label} completions`).toBe(expected);
      }
    });
  });

  it('holds no score, grade or pass mark anywhere (X2 is undecided)', async () => {
    // `constraints.md` forbids a score on the manager surface, and managers read these tables.
    // Until X2 is ruled on, this keeps the LMS on the right side of that line.
    await inRolledBackTransaction(async (client) => {
      const r = await client.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'
            and table_name in ('courses', 'course_versions', 'course_modules', 'lessons',
                               'course_assignments', 'course_enrolments', 'lesson_completions')
            -- Whole name segments, so \`market_id\` is not read as a "mark".
            and column_name ~ '(^|_)(score|scores|grade|rank|percent|percentage|mark|marks|pass|passed|fail|failed|rating)(_|$)'`,
      );
      expect(r.rows).toEqual([]);
    });
  });

  it('publishing and completing reach the audit trail', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await publishedCourse(client, world.users.admin);
      await asUser(client, world.users.puneMr);
      const e = await rpc<{ id: string }>(client, 'start_course_version', [d.versionId]);
      await rpc(client, 'complete_lesson', [e.id, d.lessonIds[0]]);

      const rows = await asOwner(client, () =>
        client.query<{ table_name: string; action: string; actor_id: string }>(
          `select table_name, action, actor_id from public.audit_log
            where row_id = any($1::text[]) and table_name in
                  ('course_versions', 'course_enrolments', 'lesson_completions')
            order by id`,
          [[d.versionId, e.id]],
        ),
      );
      const seen = rows.rows.map((r) => `${r.table_name}:${r.action}:${r.actor_id}`);
      expect(seen).toContain(`course_versions:update:${world.users.admin.id}`);
      expect(seen).toContain(`course_enrolments:insert:${world.users.puneMr.id}`);
      const completions = await asOwner(client, () =>
        client.query(
          `select 1 from public.audit_log a join public.lesson_completions c on c.id::text = a.row_id
            where c.enrolment_id = $1 and a.table_name = 'lesson_completions'`,
          [e.id],
        ),
      );
      expect(completions.rowCount).toBe(1);
    });
  });
});

/**
 * `constraints.md` FIX-07: "Audit the response shape as each endpoint converts." Every LMS RPC is
 * called for real here and parsed with the schema the frontend builds against, so a drift is a
 * red test rather than a client's first surprise.
 */
describe.skipIf(!reachable)('AI-B2 — every RPC response matches @fieldforce/core', () => {
  it('publish, assign, start, complete, cancel, retire', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftCourse(client, world.users.admin, { lessons: 1 });
      PublishCourseVersionResponseSchema.parse(
        await rpc(client, 'publish_course_version', [d.versionId]),
      );
      const a = AssignCourseResponseSchema.parse(
        await rpc(client, 'assign_course', [d.courseId, world.users.puneMr.id, '2026-12-31']),
      );
      expect(a.dueOn).toBe('2026-12-31');
      AssignCourseResponseSchema.parse(
        await rpc(client, 'assign_course', [d.courseId, world.users.nagpurMr.id, null]),
      );

      await asUser(client, world.users.puneMr);
      const e = StartCourseVersionResponseSchema.parse(
        await rpc(client, 'start_course_version', [d.versionId]),
      );
      const c = CompleteLessonResponseSchema.parse(
        await rpc(client, 'complete_lesson', [e.id, d.lessonIds[0]]),
      );
      expect(c.courseCompletedAt).not.toBeNull();

      await asUser(client, world.users.admin);
      CancelCourseAssignmentResponseSchema.parse(
        await rpc(client, 'cancel_course_assignment', [a.id]),
      );
      RetireCourseVersionResponseSchema.parse(
        await rpc(client, 'retire_course_version', [d.versionId]),
      );
    });
  });
});
