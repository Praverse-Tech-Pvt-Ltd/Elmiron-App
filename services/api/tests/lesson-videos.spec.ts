import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { LessonVideoUrlError, createLessonVideoSignedUrl } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, mintAccessToken } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * `BE-W208` — lesson videos in the private `lesson-videos` bucket
 * (`20261014000100_lesson_videos.sql`), over REAL HTTP: Storage, with real tokens, deciding by the
 * storage policies — the path a phone and the course loader take. Rows are COMMITTED, because Storage
 * reads them on its own connection.
 *
 * Each refusal has its positive control through the same request: the admin's upload into a draft
 * succeeds before the same admin's upload into the published version is refused; the assigned rep's
 * signed URL works before another company's rep is refused it; the admin reads a stray object before
 * the rep is refused it.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;
let runId = '';
let courseId = '';
let versionId = '';
let lessonA = ''; // gets the video
let lessonB = ''; // text only
let folderA = '';
let folderB = '';
let clipPath = '';
let posterPath = '';
let strayPath = '';

const CLIP = Buffer.from('synthetic mp4 bytes for a test clip. Describes nobody.');
const POSTER = Buffer.from('synthetic jpeg bytes. Describes nobody.');

const token = (who: FixtureUser | null): string => (who === null ? ANON_KEY : mintAccessToken(who));

/** POST an object into `lesson-videos`, as `who` (null: anonymous). Returns the HTTP status. */
const upload = async (
  who: FixtureUser | null,
  path: string,
  body: Buffer = CLIP,
  contentType = 'video/mp4',
  upsert = false,
): Promise<number> => {
  const res = await fetch(`${API_URL}/storage/v1/object/lesson-videos/${path}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token(who)}`,
      'content-type': contentType,
      'x-upsert': String(upsert),
    },
    body: new Uint8Array(body),
  });
  await res.text();
  return res.status;
};

/** Is the object there? Asked of the database as its owner, past every policy. */
const stored = async (path: string): Promise<boolean> =>
  withClient(async (db) => {
    const r = await db.query(
      `select 1 from storage.objects where bucket_id = 'lesson-videos' and name = $1`,
      [path],
    );
    return (r.rowCount ?? 0) === 1;
  });

const sign = async (who: FixtureUser | null, path: string): Promise<string> =>
  createLessonVideoSignedUrl(
    { baseUrl: API_URL, apiKey: ANON_KEY, accessToken: () => token(who) },
    path,
    60,
  );

const refusedToSign = async (who: FixtureUser | null, path: string): Promise<boolean> => {
  try {
    await sign(who, path);
    return false;
  } catch (error) {
    if (error instanceof LessonVideoUrlError) return true;
    throw error;
  }
};

/** Several statements as one user, committed — the way an admin's console or loader session writes. */
const asCommitted = async (who: ProfileLike, work: (db: Client) => Promise<void>) =>
  withClient(async (db) => {
    await db.query('begin');
    try {
      await asUser(db, who);
      await work(db);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  });

/** Runs `sql` in a rolled-back transaction as `who`; the SQLSTATE it failed with, or null. */
const sqlstateAs = async (who: ProfileLike, sql: string, params: unknown[] = []) =>
  inRolledBackTransaction(async (db) => {
    await asUser(db, who);
    try {
      await db.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  });

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);
  courseId = randomUUID();
  versionId = randomUUID();
  const moduleId = randomUUID();
  lessonA = randomUUID();
  lessonB = randomUUID();
  folderA = `${world.organisationId}/${versionId}/${lessonA}/`;
  folderB = `${world.organisationId}/${versionId}/${lessonB}/`;
  clipPath = `${folderA}video-${runId}.mp4`;
  posterPath = `${folderA}poster-${runId}.jpg`;
  strayPath = `${folderA}stray-${runId}.mp4`;
  await asCommitted(world.users.admin, async (db) => {
    await db.query(`insert into public.courses (id, title) values ($1, $2)`, [
      courseId,
      `Phenotyping ${runId}`,
    ]);
    await db.query(
      `insert into public.course_versions (id, course_id, organisation_id, title)
       values ($1, $2, $3, $4)`,
      [versionId, courseId, world.organisationId, `Phenotyping ${runId}`],
    );
    await db.query(
      `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
       values ($1, $2, $3, 1, 'The disease')`,
      [moduleId, versionId, world.organisationId],
    );
    for (const [i, id] of [lessonA, lessonB].entries()) {
      await db.query(
        `insert into public.lessons
           (id, module_id, course_version_id, organisation_id, position, title, body)
         values ($1, $2, $3, $4, $5, $6, 'Synthetic training text. Describes nobody.')`,
        [id, moduleId, versionId, world.organisationId, i + 1, `Lesson ${String(i + 1)}`],
      );
    }
  });
}, 180_000);

describe.skipIf(!reachable)('BE-W208 — writing a lesson video (the draft, as an admin)', () => {
  it('the bucket is private, 50 MiB, mp4 and jpeg only', async () => {
    const bucket = await withClient(async (db) =>
      db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'lesson-videos'`,
      ),
    );
    expect(bucket.rows[0]).toEqual({
      public: false,
      file_size_limit: '52428800',
      allowed_mime_types: ['video/mp4', 'image/jpeg'],
    });
  });

  it("an admin uploads into a DRAFT lesson's own folder (the positive control)", async () => {
    expect(await upload(world.users.admin, clipPath)).toBe(200);
    expect(await upload(world.users.admin, posterPath, POSTER, 'image/jpeg')).toBe(200);
    // Left in the folder and never named by the lesson: the stray-object case below.
    expect(await upload(world.users.admin, strayPath)).toBe(200);
    for (const p of [clipPath, posterPath, strayPath]) expect(await stored(p), p).toBe(true);
  });

  it('a rep, a manager and anonymous are refused — not an admin', async () => {
    for (const who of [world.users.puneMr, world.users.westManager, null]) {
      const path = `${folderB}video-${randomUUID().slice(0, 8)}.mp4`;
      expect(await upload(who, path), who?.role ?? 'anon').not.toBe(200);
      expect(await stored(path)).toBe(false);
    }
  });

  it("another company's admin is refused, in our folder or theirs-in-name", async () => {
    const intoOurs = `${folderB}video-${randomUUID().slice(0, 8)}.mp4`;
    expect(await upload(world.users.rivalAdmin, intoOurs)).not.toBe(200);
    expect(await stored(intoOurs)).toBe(false);
    // Their own organisation id, our version and lesson: the lesson is not in their organisation.
    const relabelled = `${world.rivalOrganisationId}/${versionId}/${lessonB}/video-${runId}.mp4`;
    expect(await upload(world.users.rivalAdmin, relabelled)).not.toBe(200);
    expect(await stored(relabelled)).toBe(false);
  });

  it('a path outside the convention is refused, even for our own admin', async () => {
    const otherVersion = randomUUID();
    const paths = [
      `${world.organisationId}/${versionId}/video-${runId}.mp4`, // no lesson segment
      `${folderB}sub/video-${runId}.mp4`, // nested
      `${folderB}video-${runId}.mov`, // not mp4 or jpg
      `${world.organisationId}/${otherVersion}/${lessonB}/video-${runId}.mp4`, // lesson not in that version
      `${world.organisationId}/${versionId}/${randomUUID()}/video-${runId}.mp4`, // no such lesson
      `${world.rivalOrganisationId}/${versionId}/${lessonB}/video-${runId}.mp4`, // another company's id
      `anything/video-${runId}.mp4`,
    ];
    for (const p of paths) {
      expect(await upload(world.users.admin, p), p).not.toBe(200);
      expect(await stored(p), p).toBe(false);
    }
    // And the bucket's own type rule: a text file in a valid place.
    const text = `${folderB}notes-${runId}.mp4`;
    expect(await upload(world.users.admin, text, CLIP, 'text/plain')).not.toBe(200);
    expect(await stored(text)).toBe(false);
  });

  it('the lesson may name only an object in its OWN folder that is really there', async () => {
    const admin = world.users.admin;
    // Positive control first: the right names are accepted.
    expect(
      await sqlstateAs(
        admin,
        `update public.lessons set video_object_path = $2, video_poster_path = $3, video_duration_seconds = 30 where id = $1`,
        [lessonA, clipPath, posterPath],
      ),
    ).toBeNull();
    // Lesson B naming lesson A's clip.
    expect(
      await sqlstateAs(admin, `update public.lessons set video_object_path = $2 where id = $1`, [
        lessonB,
        clipPath,
      ]),
    ).toBe('23514');
    // In its own folder, but never uploaded.
    expect(
      await sqlstateAs(admin, `update public.lessons set video_object_path = $2 where id = $1`, [
        lessonB,
        `${folderB}video-never.mp4`,
      ]),
    ).toBe('23514');
    // A poster with no video; a duration with no video; a duration of zero.
    expect(
      await sqlstateAs(admin, `update public.lessons set video_poster_path = $2 where id = $1`, [
        lessonA,
        posterPath,
      ]),
    ).toBe('23514');
    expect(
      await sqlstateAs(
        admin,
        `update public.lessons set video_duration_seconds = 5 where id = $1`,
        [lessonB],
      ),
    ).toBe('23514');
    // A rep cannot write the column at all: the admin-only write policy hides the row from the
    // update (a draft is not even readable to a rep), so nothing changes.
    const repUpdated = await inRolledBackTransaction(async (db) => {
      await asUser(db, world.users.puneMr);
      const r = await db.query(
        `update public.lessons set video_object_path = $2 where id = $1 returning id`,
        [lessonA, clipPath],
      );
      return r.rowCount;
    });
    expect(repUpdated).toBe(0);

    await asCommitted(admin, async (db) => {
      await db.query(
        `update public.lessons set video_object_path = $2, video_poster_path = $3, video_duration_seconds = 30 where id = $1`,
        [lessonA, clipPath, posterPath],
      );
    });
  });

  it("before publishing, a rep cannot sign the draft's clip; the admin can", async () => {
    expect(await refusedToSign(world.users.puneMr, clipPath)).toBe(true);
    expect(await sign(world.users.admin, clipPath)).toMatch(
      /\/storage\/v1\/object\/sign\/lesson-videos\//u,
    );
  });
});

describe.skipIf(!reachable)('BE-W208 — once published: frozen, and read by the lesson rule', () => {
  it('publish, assign', async () => {
    await asCommitted(world.users.admin, async (db) => {
      await db.query(`select public.publish_course_version($1)`, [versionId]);
      await db.query(`select public.assign_course($1, $2, null)`, [
        courseId,
        world.users.puneMr.id,
      ]);
    });
  });

  it("an upload into a PUBLISHED version's folder is refused, even for the admin", async () => {
    const late = `${folderB}video-late-${runId}.mp4`;
    expect(await upload(world.users.admin, late)).not.toBe(200);
    expect(await stored(late)).toBe(false);
  });

  it("a published lesson's video is frozen exactly like its body", async () => {
    expect(
      await sqlstateAs(
        world.users.admin,
        `update public.lessons set video_object_path = null, video_poster_path = null, video_duration_seconds = null where id = $1`,
        [lessonA],
      ),
    ).toBe('23514');
    expect(
      await sqlstateAs(world.users.admin, `update public.lessons set body = 'x' where id = $1`, [
        lessonA,
      ]),
    ).toBe('23514');
  });

  it('the assigned rep gets a signed URL — through the app’s own transport — and it plays the clip', async () => {
    const live = (await import(
      fileURLToPath(new URL('../../../apps/field/src/learning/live.ts', import.meta.url))
    )) as {
      createLiveLearningBackend: (c: {
        baseUrl: string;
        apiKey: string;
        accessToken: () => Promise<string | null>;
      }) => {
        lesson: (l: string, e: string) => Promise<Record<string, unknown> | null>;
        videoUrl: (p: string) => Promise<string>;
      };
    };
    const backend = live.createLiveLearningBackend({
      baseUrl: API_URL,
      apiKey: ANON_KEY,
      accessToken: () => Promise.resolve(mintAccessToken(world.users.puneMr)),
    });
    const lesson = await backend.lesson(lessonA, randomUUID());
    expect(lesson?.['video']).toEqual({
      objectPath: clipPath,
      posterPath,
      durationSeconds: 30,
    });
    expect((await backend.lesson(lessonB, randomUUID()))?.['video']).toBeNull();

    const url = await backend.videoUrl(clipPath);
    const got = await fetch(url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(CLIP)).toBe(true);
    const poster = await fetch(await backend.videoUrl(posterPath));
    expect(poster.status).toBe(200);
  });

  it('a rep of another company is refused the URL; so are their admin and anonymous', async () => {
    for (const who of [world.users.rivalMr, world.users.rivalAdmin, null]) {
      expect(await refusedToSign(who, clipPath), who?.role ?? 'anon').toBe(true);
    }
    // And a direct authenticated download is refused the same way.
    const direct = await fetch(
      `${API_URL}/storage/v1/object/authenticated/lesson-videos/${clipPath}`,
      {
        headers: { apikey: ANON_KEY, authorization: `Bearer ${token(world.users.rivalMr)}` },
      },
    );
    expect(direct.ok).toBe(false);
  });

  it('a rep reads only what the lesson names — not a stray object in its folder (the admin can)', async () => {
    expect(await sign(world.users.admin, strayPath)).toContain('/lesson-videos/');
    expect(await refusedToSign(world.users.puneMr, strayPath)).toBe(true);
    // Same company, another rep who was NOT assigned: the lesson rule does not require assignment.
    expect(await refusedToSign(world.users.southMr, clipPath)).toBe(false);
  });

  it('no one overwrites or deletes a clip through the API', async () => {
    // An upsert onto the existing object, as the admin.
    expect(await upload(world.users.admin, clipPath, POSTER, 'video/mp4', true)).not.toBe(200);
    const put = await fetch(`${API_URL}/storage/v1/object/lesson-videos/${clipPath}`, {
      method: 'PUT',
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${token(world.users.admin)}`,
        'content-type': 'video/mp4',
      },
      body: new Uint8Array(POSTER),
    });
    await put.text();
    expect(put.ok).toBe(false);
    const del = await fetch(`${API_URL}/storage/v1/object/lesson-videos`, {
      method: 'DELETE',
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${token(world.users.admin)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [clipPath] }),
    });
    await del.text();
    expect(await stored(clipPath)).toBe(true);
    // The bytes are still the original clip.
    const again = await fetch(await sign(world.users.puneMr, clipPath));
    expect(Buffer.from(await again.arrayBuffer()).equals(CLIP)).toBe(true);
  });
});
