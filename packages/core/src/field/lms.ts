import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * LMS core — AI-B2, `20260924000500_lms_core.sql`.
 *
 * **A published version never changes.** A course is only a name; its content lives in versions.
 * A version is `draft` (admin-editable), then `published` (frozen, with its modules and lessons),
 * then `retired` (still frozen, closed to new learners). An enrolment pins a version, so what a
 * learner completed is always the exact text they read.
 *
 * **Reads** are PostgREST table reads (snake_case on the wire; the entity shapes below are the
 * camelCase a client maps them to). **Writes of state** go through the RPCs in `LMS_RPC`, whose
 * responses are already camelCase and are parsed against the response schemas below by
 * `services/api/tests/lms-core.spec.ts`.
 *
 * **Refusals** use the existing SQLSTATEs, no new ones: `28000` not signed in, `42501` not yours /
 * not permitted, `22023` wrong state (already published, not published, no lessons, retired to
 * new learners). A client's honest response to a `22023` here is to refresh and show the current
 * state.
 *
 * **Deliberately absent: any score, grade, mark or pass/fail.** Managers read enrolments, and
 * `.ai-collab/constraints.md` forbids a score on the manager surface. Whether training
 * assessments are exempt is decision X2 (`docs/ai-platform/phase-a-recon.md`); until it is made,
 * `contract.test.ts` holds these schemas to it.
 */

export const COURSE_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export const CourseVersionStatusSchema = z.enum(COURSE_VERSION_STATUSES);
export type CourseVersionStatus = z.infer<typeof CourseVersionStatusSchema>;

// ---------------------------------------------------------------------------
// Lesson videos — `BE-W208` (`20261014000100_lesson_videos.sql`), `BE-W211`
// ---------------------------------------------------------------------------

/** The private bucket lesson clips and their posters live in. No public URL exists for it. */
export const LESSON_VIDEO_BUCKET = 'lesson-videos';
/** One object's limit: 50 MiB — the bucket's, `config.toml`'s, and the Free plan's per-file limit. */
export const LESSON_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/**
 * How long a signed URL lives. An hour: long enough for a rep to pause a clip (the longest that fits
 * the size limit is under half an hour) and resume while the player still holds the URL, short enough
 * that a URL copied out of a log is soon worth nothing. The app asks for one only when the rep presses
 * play.
 */
export const LESSON_VIDEO_URL_TTL_SECONDS = 3600;

const UUID_PART = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * `<organisation_id>/<course_version_id>/<lesson_id>/<file>.mp4|.jpg` — the convention the storage
 * policies read to decide whose draft an object belongs to. Mirrors `lesson_video_path_parts`.
 */
export const LessonVideoPathSchema = z
  .string()
  .regex(
    new RegExp(
      `^${UUID_PART}/${UUID_PART}/${UUID_PART}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.(mp4|jpg)$`,
      'u',
    ),
  );

/** The folder one lesson's clip and poster go in. */
export const lessonVideoFolder = (ids: {
  readonly organisationId: string;
  readonly courseVersionId: string;
  readonly lessonId: string;
}): string => `${ids.organisationId}/${ids.courseVersionId}/${ids.lessonId}/`;

/** Storage's answer to `POST /storage/v1/object/sign/<bucket>/<path>`: a path relative to `/storage/v1`. */
export const SignedObjectUrlResponseSchema = z.object({ signedURL: z.string().min(1) });

/** A refusal from Storage. `notFound` covers "no such object" AND "RLS will not let you read it". */
export class LessonVideoUrlError extends Error {
  constructor(
    readonly status: number,
    readonly notFound: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'LessonVideoUrlError';
  }
}

export interface StorageConnection {
  /** The Supabase project URL. */
  readonly baseUrl: string;
  /** The project's publishable key — identifies the project, never the user. */
  readonly apiKey: string;
  /** The SIGNED-IN user's access token: Storage signs only what RLS lets this user read. */
  readonly accessToken: () => string | null | Promise<string | null>;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * `BE-W211` — a short-lived URL for one lesson clip or poster, created AS THE SIGNED-IN USER.
 *
 * Storage issues the URL only when the caller's SELECT on the object passes
 * `lesson_videos_select_readable_lesson` — the lesson's own read rule — so whether a rep may watch is
 * decided by the database, never by this function. A refusal and a missing object look the same
 * (Storage answers 400 with a 404 in the body for both), and both throw `LessonVideoUrlError`; no
 * answer at all (no signal) throws what `fetch` threw.
 */
export const createLessonVideoSignedUrl = async (
  c: StorageConnection,
  objectPath: string,
  expiresInSeconds: number = LESSON_VIDEO_URL_TTL_SECONDS,
): Promise<string> => {
  const token = await c.accessToken();
  if (token === null) throw new LessonVideoUrlError(401, false, 'not signed in');
  const base = c.baseUrl.replace(/\/+$/u, '');
  const doFetch = c.fetch ?? globalThis.fetch;
  const response = await doFetch(
    `${base}/storage/v1/object/sign/${LESSON_VIDEO_BUCKET}/${encodeURI(objectPath)}`,
    {
      method: 'POST',
      headers: {
        apikey: c.apiKey,
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    },
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as { statusCode?: unknown; error?: unknown; message?: unknown };
    const notFound =
      response.status === 404 ||
      String(record.statusCode) === '404' ||
      record.error === 'not_found';
    throw new LessonVideoUrlError(
      response.status,
      notFound,
      typeof record.message === 'string' ? record.message : `HTTP ${String(response.status)}`,
    );
  }
  const parsed = SignedObjectUrlResponseSchema.parse(body);
  return parsed.signedURL.startsWith('http')
    ? parsed.signedURL
    : `${base}/storage/v1${parsed.signedURL.startsWith('/') ? '' : '/'}${parsed.signedURL}`;
};

// ---------------------------------------------------------------------------
// Entities (table reads)
// ---------------------------------------------------------------------------

export const CourseSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  title: z.string().min(1),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Course = z.infer<typeof CourseSchema>;

export const CourseVersionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseId: UuidSchema,
  /** Assigned by the server: 1, 2, 3 … per course. */
  versionNumber: z.number().int().positive(),
  status: CourseVersionStatusSchema,
  title: z.string().min(1),
  summary: z.string().nullable(),
  productId: UuidSchema.nullable(),
  /** Null = not specific to a market. */
  marketId: UuidSchema.nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  publishedByUserId: UuidSchema.nullable(),
  retiredAt: IsoDateTimeSchema.nullable(),
  retiredByUserId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CourseVersion = z.infer<typeof CourseVersionSchema>;

export const CourseModuleSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseVersionId: UuidSchema,
  position: z.number().int().positive(),
  title: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CourseModule = z.infer<typeof CourseModuleSchema>;

export const LessonSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  moduleId: UuidSchema,
  courseVersionId: UuidSchema,
  position: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  estimatedMinutes: z.number().int().positive().nullable(),
  /**
   * `BE-W208` — the lesson's clip in the private `lesson-videos` bucket, or null for a text-only
   * lesson. Frozen with the version exactly like `body`. Never a URL: a client asks for a short-lived
   * signed URL (`createLessonVideoSignedUrl`), and Storage issues it only if RLS lets the caller read
   * the lesson.
   */
  videoObjectPath: LessonVideoPathSchema.nullable(),
  /** The clip's poster (JPEG) in the same folder, or null. Only with a video. */
  videoPosterPath: LessonVideoPathSchema.nullable(),
  /** The clip's length as measured at load, or null when it could not be measured. */
  videoDurationSeconds: z.number().int().positive().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Lesson = z.infer<typeof LessonSchema>;

export const CourseAssignmentSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseId: UuidSchema,
  assigneeUserId: UuidSchema,
  assignedByUserId: UuidSchema,
  /**
   * A date, not an instant. "Overdue" is NOT a field: it is a computation against the server's
   * clock at read time, and cannot ride `sync_pull` (`constraints.md`).
   */
  dueOn: IsoDateSchema.nullable(),
  assignedAt: IsoDateTimeSchema,
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancelledByUserId: UuidSchema.nullable(),
});
export type CourseAssignment = z.infer<typeof CourseAssignmentSchema>;

export const CourseEnrolmentSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  userId: UuidSchema,
  courseVersionId: UuidSchema,
  startedAt: IsoDateTimeSchema,
  /** Stamped once by the server when the last lesson is completed. Never moves. */
  completedAt: IsoDateTimeSchema.nullable(),
});
export type CourseEnrolment = z.infer<typeof CourseEnrolmentSchema>;

export const LessonCompletionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  enrolmentId: UuidSchema,
  userId: UuidSchema,
  lessonId: UuidSchema,
  completedAt: IsoDateTimeSchema,
});
export type LessonCompletion = z.infer<typeof LessonCompletionSchema>;

// ---------------------------------------------------------------------------
// RPCs (state changes)
// ---------------------------------------------------------------------------

/** PostgREST RPC names, `POST /rest/v1/rpc/<name>`, and who may call each. */
export const LMS_RPC = {
  /** Admin. Draft -> published; retires the previous published version for the same market. */
  publishCourseVersion: 'publish_course_version',
  /** Admin. Published -> retired. */
  retireCourseVersion: 'retire_course_version',
  /** Admin or field manager, for a user they can already see. Idempotent. */
  assignCourse: 'assign_course',
  /** Admin or field manager, within the same scope. Once. */
  cancelCourseAssignment: 'cancel_course_assignment',
  /** Anyone, for themselves. Idempotent: starting twice resumes. */
  startCourseVersion: 'start_course_version',
  /** Anyone, for their own enrolment. Idempotent. */
  completeLesson: 'complete_lesson',
} as const;

export const PublishCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const PublishCourseVersionResponseSchema = z.object({
  courseVersionId: UuidSchema,
  status: z.literal('published'),
  publishedAt: IsoDateTimeSchema,
  retiredCourseVersionIds: z.array(UuidSchema),
});
export type PublishCourseVersionResponse = z.infer<typeof PublishCourseVersionResponseSchema>;

export const RetireCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const RetireCourseVersionResponseSchema = z.object({
  courseVersionId: UuidSchema,
  status: z.literal('retired'),
  retiredAt: IsoDateTimeSchema,
});
export type RetireCourseVersionResponse = z.infer<typeof RetireCourseVersionResponseSchema>;

export const AssignCourseRequestSchema = z.object({
  p_course_id: UuidSchema,
  p_assignee_user_id: UuidSchema,
  p_due_on: IsoDateSchema.nullish(),
});
export const AssignCourseResponseSchema = z.object({
  id: UuidSchema,
  courseId: UuidSchema,
  assigneeUserId: UuidSchema,
  assignedByUserId: UuidSchema,
  dueOn: IsoDateSchema.nullable(),
  assignedAt: IsoDateTimeSchema,
});
export type AssignCourseResponse = z.infer<typeof AssignCourseResponseSchema>;

export const CancelCourseAssignmentRequestSchema = z.object({ p_assignment_id: UuidSchema });
export const CancelCourseAssignmentResponseSchema = z.object({
  id: UuidSchema,
  cancelledAt: IsoDateTimeSchema,
});
export type CancelCourseAssignmentResponse = z.infer<typeof CancelCourseAssignmentResponseSchema>;

export const StartCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const StartCourseVersionResponseSchema = z.object({
  id: UuidSchema,
  courseVersionId: UuidSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});
export type StartCourseVersionResponse = z.infer<typeof StartCourseVersionResponseSchema>;

export const CompleteLessonRequestSchema = z.object({
  p_enrolment_id: UuidSchema,
  p_lesson_id: UuidSchema,
});
export const CompleteLessonResponseSchema = z.object({
  enrolmentId: UuidSchema,
  lessonId: UuidSchema,
  lessonCompletedAt: IsoDateTimeSchema,
  lessonsCompleted: z.number().int().nonnegative(),
  lessonsTotal: z.number().int().positive(),
  courseCompletedAt: IsoDateTimeSchema.nullable(),
});
export type CompleteLessonResponse = z.infer<typeof CompleteLessonResponseSchema>;
