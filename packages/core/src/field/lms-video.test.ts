import { describe, expect, it } from 'vitest';
import {
  LESSON_VIDEO_BUCKET,
  LESSON_VIDEO_URL_TTL_SECONDS,
  LessonSchema,
  LessonVideoPathSchema,
  LessonVideoUrlError,
  createLessonVideoSignedUrl,
  lessonVideoFolder,
} from './lms.js';

/**
 * `BE-W211` — the contract half of lesson videos: the path convention the storage policies read, the
 * lesson's video fields, and the signed-URL request a client makes AS THE SIGNED-IN USER. The rules
 * themselves are the database's (`services/api/tests/lesson-videos.spec.ts`); this proves the request
 * is the one Storage answers and that a refusal is never read as a URL.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const VER = '22222222-2222-4222-8222-222222222222';
const LES = '33333333-3333-4333-8333-333333333333';
const PATH = `${lessonVideoFolder({ organisationId: ORG, courseVersionId: VER, lessonId: LES })}video-ab12.mp4`;

const recorder = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

describe('lesson video paths (BE-W208 convention)', () => {
  it('accepts a clip and a poster in a lesson folder, and nothing else', () => {
    expect(LessonVideoPathSchema.safeParse(PATH).success).toBe(true);
    expect(LessonVideoPathSchema.safeParse(PATH.replace('.mp4', '.jpg')).success).toBe(true);
    for (const bad of [
      `${ORG}/${VER}/video.mp4`, // no lesson segment
      `${ORG}/${VER}/${LES}/video.mov`, // not mp4 or jpg
      `${ORG}/${VER}/${LES}/videoXmp4`, // the dot is a dot, not "any character"
      `${ORG}/${VER}/${LES}/../x.mp4`,
      `ABCDEF01-1111-4111-8111-111111111111/${VER}/${LES}/v.mp4`, // the database writes uuids lower-case
    ]) {
      expect(LessonVideoPathSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('a lesson carries its video fields, null for a text-only lesson', () => {
    const lesson = {
      id: LES,
      organisationId: ORG,
      moduleId: LES,
      courseVersionId: VER,
      position: 1,
      title: 'Phenotyping',
      body: 'Text.',
      estimatedMinutes: 4,
      videoObjectPath: null,
      videoPosterPath: null,
      videoDurationSeconds: null,
      createdAt: '2026-10-14T05:00:00+00:00',
      updatedAt: '2026-10-14T05:00:00+00:00',
    };
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
    expect(
      LessonSchema.safeParse({ ...lesson, videoObjectPath: PATH, videoDurationSeconds: 754 })
        .success,
    ).toBe(true);
    expect(LessonSchema.safeParse({ ...lesson, videoDurationSeconds: 0 }).success).toBe(false);
  });
});

describe('createLessonVideoSignedUrl (BE-W211)', () => {
  const conn = (fetchImpl: typeof fetch, token: string | null = 'rep-token') => ({
    baseUrl: 'http://127.0.0.1:54321/',
    apiKey: 'publishable',
    accessToken: () => token,
    fetch: fetchImpl,
  });

  it('asks Storage as the signed-in user, and returns the full URL Storage signed', async () => {
    const { calls, fetchImpl } = recorder(200, {
      signedURL: `/object/sign/${LESSON_VIDEO_BUCKET}/${PATH}?token=abc`,
    });
    const url = await createLessonVideoSignedUrl(conn(fetchImpl), PATH);
    expect(url).toBe(
      `http://127.0.0.1:54321/storage/v1/object/sign/${LESSON_VIDEO_BUCKET}/${PATH}?token=abc`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `http://127.0.0.1:54321/storage/v1/object/sign/${LESSON_VIDEO_BUCKET}/${PATH}`,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    // The USER's token decides; the publishable key only names the project.
    expect(headers['Authorization']).toBe('Bearer rep-token');
    expect(headers['apikey']).toBe('publishable');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      expiresIn: LESSON_VIDEO_URL_TTL_SECONDS,
    });
  });

  it('a refusal (Storage: 400 with a 404 in the body) throws, never returns a URL', async () => {
    const { fetchImpl } = recorder(400, {
      statusCode: '404',
      error: 'not_found',
      message: 'Object not found',
    });
    const error = await createLessonVideoSignedUrl(conn(fetchImpl), PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LessonVideoUrlError);
    expect((error as LessonVideoUrlError).notFound).toBe(true);
    expect((error as LessonVideoUrlError).status).toBe(400);
  });

  it('nobody signed in: refused before any request', async () => {
    const { calls, fetchImpl } = recorder(200, { signedURL: '/x' });
    await expect(createLessonVideoSignedUrl(conn(fetchImpl, null), PATH)).rejects.toBeInstanceOf(
      LessonVideoUrlError,
    );
    expect(calls).toHaveLength(0);
  });

  it('no signal: what fetch threw comes through unchanged (the app calls that offline)', async () => {
    const offline = new TypeError('Network request failed');
    const fetchImpl = (async () => Promise.reject(offline)) as unknown as typeof fetch;
    await expect(createLessonVideoSignedUrl(conn(fetchImpl), PATH)).rejects.toBe(offline);
  });
});
