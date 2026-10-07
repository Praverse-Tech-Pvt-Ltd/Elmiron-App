import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, signIn } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W2-F B5 — the LEARNING screens' own transport, end to end, against the local stack: the app's
 * `createLiveLearningBackend` and the decisions in `view.ts`, loaded from `apps/field` by path (the
 * reason `mr-chat.spec.ts` gives, W1-Z B3), as the signed-in rep with a real token. Not a test calling
 * the RPCs: every read and both writes go through the code the screens call.
 *
 * The course is written the way an admin writes one today — rows and `publish_course_version`, then
 * `assign_course` — because no console screen authors courses (W1-Z C).
 */
const reachable = await requireDatabase();

interface Connection {
  baseUrl: string;
  apiKey: string;
  accessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}
interface Row {
  [key: string]: unknown;
}
interface Backend {
  myCourses(): Promise<{ assignments: Row[]; versions: Row[]; enrolments: Row[] }>;
  course(courseId: string): Promise<{ title: string | null; versions: Row[]; enrolments: Row[] }>;
  outline(versionId: string, enrolmentId: string): Promise<Row>;
  lesson(lessonId: string, enrolmentId: string): Promise<Row | null>;
  start(versionId: string): Promise<Row>;
  complete(enrolmentId: string, lessonId: string): Promise<Row>;
}
interface FieldModules {
  createLiveLearningBackend: (c: Connection) => Backend;
  courseState: (courseId: string, versions: Row[], enrolments: Row[]) => Row;
  myCourseItems: (data: unknown, day: (iso: string) => string) => Row[];
  outlineSections: (rows: unknown) => { sections: Row[]; done: number; total: number };
}

const field = async (): Promise<FieldModules> => {
  const load = async (rel: string): Promise<Record<string, unknown>> =>
    (await import(fileURLToPath(new URL(rel, import.meta.url)))) as Record<string, unknown>;
  const live = await load('../../../apps/field/src/learning/live.ts');
  const view = await load('../../../apps/field/src/learning/view.ts');
  return {
    createLiveLearningBackend: live[
      'createLiveLearningBackend'
    ] as FieldModules['createLiveLearningBackend'],
    courseState: view['courseState'] as FieldModules['courseState'],
    myCourseItems: view['myCourseItems'] as FieldModules['myCourseItems'],
    outlineSections: view['outlineSections'] as FieldModules['outlineSections'],
  };
};

let world: FixtureWorld;
let runId = '';
let courseId = '';
let versionId = '';
let lessonIds: string[] = [];
let repToken = '';
let rivalToken = '';

/** Several statements as one user, committed — the way an admin's console session writes. */
const asCommitted = async (db: Client, who: ProfileLike, work: () => Promise<void>) => {
  await db.query('begin');
  try {
    await asUser(db, who);
    await work();
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
};

const connection = (token: () => Promise<string | null>, f?: typeof fetch): Connection => ({
  baseUrl: API_URL,
  apiKey: ANON_KEY,
  accessToken: token,
  ...(f === undefined ? {} : { fetch: f }),
});

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);
  courseId = randomUUID();
  versionId = randomUUID();
  const moduleId = randomUUID();
  lessonIds = [randomUUID(), randomUUID()];
  await withClient(async (db) => {
    const admin = world.users.admin;
    await asCommitted(db, admin, async () => {
      await db.query(`insert into public.courses (id, title) values ($1, $2)`, [
        courseId,
        `Storage basics ${runId}`,
      ]);
      await db.query(
        `insert into public.course_versions (id, course_id, organisation_id, title)
         values ($1, $2, $3, $4)`,
        [versionId, courseId, world.organisationId, `Storage basics ${runId}`],
      );
      await db.query(
        `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
         values ($1, $2, $3, 1, 'Keeping stock')`,
        [moduleId, versionId, world.organisationId],
      );
      for (const [i, id] of lessonIds.entries()) {
        await db.query(
          `insert into public.lessons
             (id, module_id, course_version_id, organisation_id, position, title, body, estimated_minutes)
           values ($1, $2, $3, $4, $5, $6, $7, 5)`,
          [
            id,
            moduleId,
            versionId,
            world.organisationId,
            i + 1,
            `Lesson ${String(i + 1)} ${runId}`,
            `Synthetic training text ${String(i + 1)} for run ${runId}. Describes nobody.`,
          ],
        );
      }
      await db.query(`select public.publish_course_version($1)`, [versionId]);
      await db.query(`select public.assign_course($1, $2, $3::date)`, [
        courseId,
        world.users.puneMr.id,
        '2026-10-15',
      ]);
    });
  });
  repToken = (await signIn(world.users.puneMr.email, world.users.puneMr.password)).accessToken;
  rivalToken = (await signIn(world.users.rivalMr.email, world.users.rivalMr.password)).accessToken;
}, 180_000);

describe.skipIf(!reachable)('W2-F B5 — the learning screens’ own transport, end to end', () => {
  it('assigned → started → read → each lesson finished → the course finished, as the rep', async () => {
    const { createLiveLearningBackend, courseState, myCourseItems, outlineSections } =
      await field();
    const backend = createLiveLearningBackend(connection(() => Promise.resolve(repToken)));
    const day = (iso: string) => `DAY(${iso.slice(0, 10)})`;
    const mine = (items: Row[]) => items.find((i) => i['courseId'] === courseId);

    // ASSIGNED, not started: the list says so, with the due date as a date.
    const before = await backend.myCourses();
    expect(mine(myCourseItems(before, day))).toEqual({
      courseId,
      title: `Storage basics ${runId}`,
      due: 'Due 15 Oct',
      line: 'Not started',
    });
    expect(courseState(courseId, before.versions, before.enrolments)).toEqual({
      kind: 'can_start',
      choices: [{ versionId, label: `Storage basics ${runId}` }],
    });

    // STARTED: the server's enrolment, pinned to this version. Starting again resumes it.
    const started = await backend.start(versionId);
    expect(started['courseVersionId']).toBe(versionId);
    expect((await backend.start(versionId))['id']).toBe(started['id']);
    const enrolmentId = String(started['id']);
    const course = await backend.course(courseId);
    expect(course.title).toBe(`Storage basics ${runId}`);
    expect(courseState(courseId, course.versions, course.enrolments)).toMatchObject({
      kind: 'started',
      enrolmentId,
      versionId,
      completedAt: null,
    });
    expect(mine(myCourseItems(await backend.myCourses(), day))?.['line']).toBe(
      `Started DAY(${String(started['startedAt']).slice(0, 10)})`,
    );

    // THE OUTLINE: one module, two lessons in order, none done.
    const outline = outlineSections(await backend.outline(versionId, enrolmentId));
    expect(outline.done).toBe(0);
    expect(outline.total).toBe(2);
    expect(outline.sections).toEqual([
      {
        title: 'Keeping stock',
        lessons: [
          { id: lessonIds[0], title: `Lesson 1 ${runId}`, minutes: 5, done: false },
          { id: lessonIds[1], title: `Lesson 2 ${runId}`, minutes: 5, done: false },
        ],
      },
    ]);

    // READ the first lesson in full; not finished yet.
    const first = await backend.lesson(String(lessonIds[0]), enrolmentId);
    expect(first).toMatchObject({
      title: `Lesson 1 ${runId}`,
      body: `Synthetic training text 1 for run ${runId}. Describes nobody.`,
      completedAt: null,
    });

    // FINISH it: the server's stamp, 1 of 2, the course not finished.
    const one = await backend.complete(enrolmentId, String(lessonIds[0]));
    expect(one).toMatchObject({ lessonsCompleted: 1, lessonsTotal: 2, courseCompletedAt: null });
    expect((await backend.lesson(String(lessonIds[0]), enrolmentId))?.['completedAt']).toBe(
      one['lessonCompletedAt'],
    );
    expect(outlineSections(await backend.outline(versionId, enrolmentId)).done).toBe(1);

    // The LAST lesson: the server stamps the course finished, once. Finishing again changes nothing.
    const two = await backend.complete(enrolmentId, String(lessonIds[1]));
    expect(two).toMatchObject({ lessonsCompleted: 2, lessonsTotal: 2 });
    expect(two['courseCompletedAt']).toEqual(expect.any(String));
    const again = await backend.complete(enrolmentId, String(lessonIds[1]));
    expect(again).toMatchObject({
      lessonsCompleted: 2,
      courseCompletedAt: two['courseCompletedAt'],
      lessonCompletedAt: two['lessonCompletedAt'],
    });
    expect(mine(myCourseItems(await backend.myCourses(), day))?.['line']).toBe(
      `Finished DAY(${String(two['courseCompletedAt']).slice(0, 10)})`,
    );
  });

  it('a CANCELLED assignment is not on the list — it is history, not something asked of the rep', async () => {
    const { createLiveLearningBackend } = await field();
    const cancelledCourse = randomUUID();
    await withClient(async (db) => {
      await asCommitted(db, world.users.admin, async () => {
        await db.query(`insert into public.courses (id, title) values ($1, $2)`, [
          cancelledCourse,
          `Withdrawn ${runId}`,
        ]);
        // `assign_course` refuses a course with no published version, so it gets one first.
        const v = randomUUID();
        const m = randomUUID();
        await db.query(
          `insert into public.course_versions (id, course_id, organisation_id, title) values ($1, $2, $3, 'Withdrawn')`,
          [v, cancelledCourse, world.organisationId],
        );
        await db.query(
          `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
           values ($1, $2, $3, 1, 'Only')`,
          [m, v, world.organisationId],
        );
        await db.query(
          `insert into public.lessons (id, module_id, course_version_id, organisation_id, position, title, body)
           values ($1, $2, $3, $4, 1, 'Only', 'Synthetic. Describes nobody.')`,
          [randomUUID(), m, v, world.organisationId],
        );
        await db.query(`select public.publish_course_version($1)`, [v]);
        const { rows } = await db.query<{ r: { id: string } }>(
          `select public.assign_course($1, $2, null) as r`,
          [cancelledCourse, world.users.puneMr.id],
        );
        await db.query(`select public.cancel_course_assignment($1)`, [rows[0]?.r.id]);
      });
    });
    const backend = createLiveLearningBackend(connection(() => Promise.resolve(repToken)));
    const ids = (await backend.myCourses()).assignments.map((a) => a['courseId']);
    expect(ids).toContain(courseId);
    expect(ids).not.toContain(cancelledCourse);
  });

  it('with nobody signed in, NOTHING is sent — refused before the network', async () => {
    const { createLiveLearningBackend } = await field();
    let sent = 0;
    const counting: typeof fetch = (...args) => {
      sent += 1;
      return fetch(...args);
    };
    const backend = createLiveLearningBackend(connection(() => Promise.resolve(null), counting));
    await expect(backend.myCourses()).rejects.toMatchObject({ status: 401, code: '28000' });
    await expect(backend.complete(randomUUID(), randomUUID())).rejects.toMatchObject({
      code: '28000',
    });
    expect(sent).toBe(0);
  });

  it('another company’s rep is shown nothing of ours and can start nothing of ours', async () => {
    const { createLiveLearningBackend } = await field();
    const rival = createLiveLearningBackend(connection(() => Promise.resolve(rivalToken)));
    const theirs = await rival.myCourses();
    expect(theirs.assignments.map((a) => a['courseId'])).not.toContain(courseId);
    const course = await rival.course(courseId);
    expect(course).toEqual({ title: null, versions: [], enrolments: [] });
    expect(await rival.lesson(String(lessonIds[0]), randomUUID())).toBeNull();
    await expect(rival.start(versionId)).rejects.toMatchObject({ code: '42501' });
  });

  it('a lesson cannot be finished on someone else’s enrolment', async () => {
    const { createLiveLearningBackend } = await field();
    const rep = createLiveLearningBackend(connection(() => Promise.resolve(repToken)));
    const { id: enrolmentId } = await rep.start(versionId);
    const nagpur = createLiveLearningBackend(
      connection(
        async () =>
          (await signIn(world.users.nagpurMr.email, world.users.nagpurMr.password)).accessToken,
      ),
    );
    await expect(nagpur.complete(String(enrolmentId), String(lessonIds[0]))).rejects.toMatchObject({
      code: '42501',
    });
  });
});
