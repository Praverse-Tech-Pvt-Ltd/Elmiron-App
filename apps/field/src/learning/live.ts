import {
  CompleteLessonResponseSchema,
  LMS_RPC,
  LessonVideoUrlError,
  StartCourseVersionResponseSchema,
  createLessonVideoSignedUrl,
} from '@fieldforce/core';
import type { CompleteLessonResponse, StartCourseVersionResponse } from '@fieldforce/core';
import { LiveRequestError, callRpc, selectRows } from '../live-rest';
import type { LiveConnection } from '../live-rest';

/**
 * W2-F B — a rep's learning, on the REAL server. There is no sample behind it: the screens are off by
 * a flag instead (`learningEnabled`), as Product Q&A is.
 *
 * **What a rep may do, from the schema (`20260924000500_lms_core.sql`), not from the word "LMS":**
 * a rep READS their own assignments, the published (or retired) versions of their company's courses,
 * those versions' modules and lessons, and their own enrolments and completions — every read below is
 * a plain table read under those row rules. A rep WRITES exactly two things, both through RPCs that
 * hold the rules: an enrolment (`start_course_version`, which pins one version) and a lesson
 * completion (`complete_lesson`, append-only; the server stamps the course finished on the last one).
 * Assignment points at a COURSE, not a version — which version to open is decided in `view.ts`.
 */

export interface AssignmentRow {
  readonly id: string;
  readonly courseId: string;
  readonly courseTitle: string;
  /** `YYYY-MM-DD`, a date with no time and no zone, or null. */
  readonly dueOn: string | null;
}

export interface VersionRow {
  readonly id: string;
  readonly courseId: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly summary: string | null;
  readonly status: 'published' | 'retired';
  /** The market's name, or null for a version that is not market-specific. */
  readonly marketName: string | null;
}

export interface EnrolmentRow {
  readonly id: string;
  readonly versionId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface OutlineRows {
  readonly modules: readonly {
    readonly id: string;
    readonly position: number;
    readonly title: string;
  }[];
  readonly lessons: readonly {
    readonly id: string;
    readonly moduleId: string;
    readonly position: number;
    readonly title: string;
    readonly estimatedMinutes: number | null;
  }[];
  /** The lesson ids this enrolment has completed, as the server holds them. */
  readonly completedLessonIds: ReadonlySet<string>;
}

/**
 * `FE-W127` / `BE-W208` — a lesson's clip, as the lesson row names it: object paths in the PRIVATE
 * `lesson-videos` bucket, never URLs. A URL is asked for (`videoUrl`) only when the rep presses play.
 */
/**
 * `FE-W193` — what a course version holds, shown BEFORE the rep starts it: how many lessons, and how
 * long they take in all. The read rules let a rep read a published version's lessons without an
 * enrolment (`lessons_select_readable`), so the course page no longer offers "Start this course"
 * under nothing but a title.
 */
export interface CoursePreview {
  readonly lessons: number;
  /** The sum of the lessons' estimates, or null when any lesson has none — never an under-count. */
  readonly minutes: number | null;
}

export interface LessonVideoRef {
  readonly objectPath: string;
  readonly posterPath: string | null;
  readonly durationSeconds: number | null;
}

export interface LessonRow {
  readonly id: string;
  readonly versionId: string;
  readonly title: string;
  readonly body: string;
  readonly estimatedMinutes: number | null;
  /** When the server recorded this enrolment finishing it, or null. */
  readonly completedAt: string | null;
  /** The lesson's video, or null for a text-only lesson. */
  readonly video: LessonVideoRef | null;
}

export interface LearningBackend {
  /** The rep's live assignments, the readable versions of those courses, and the rep's enrolments. */
  myCourses(): Promise<{
    readonly assignments: readonly AssignmentRow[];
    readonly versions: readonly VersionRow[];
    readonly enrolments: readonly EnrolmentRow[];
  }>;
  /** One course: its title, its readable versions, and the rep's enrolments in any of them. */
  course(courseId: string): Promise<{
    readonly title: string | null;
    readonly versions: readonly VersionRow[];
    readonly enrolments: readonly EnrolmentRow[];
  }>;
  /** `FE-W193`. A version's lesson count and total estimate, read before it is started. */
  preview(versionId: string): Promise<CoursePreview>;
  /** One version's modules and lessons (titles only), and what this enrolment has completed. */
  outline(versionId: string, enrolmentId: string): Promise<OutlineRows>;
  /** One lesson in full, with whether this enrolment has completed it; null if not readable. */
  lesson(lessonId: string, enrolmentId: string): Promise<LessonRow | null>;
  start(versionId: string): Promise<StartCourseVersionResponse>;
  complete(enrolmentId: string, lessonId: string): Promise<CompleteLessonResponse>;
  /**
   * `FE-W127` — a short-lived signed URL for a lesson clip or poster, created as the signed-in rep:
   * Storage signs it only when RLS lets the rep read the lesson. A refusal is a `LiveRequestError`
   * (the screen's "did not load"); no answer at all is what `fetch` threw (the screen's "no signal").
   */
  videoUrl(objectPath: string): Promise<string>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const intOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const one = (value: unknown): Record<string, unknown> | null => {
  // PostgREST embeds a to-one relation as an object.
  const row: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : null;
};
const inList = (ids: readonly string[]): string => `in.(${ids.join(',')})`;

const VERSION_COLUMNS = 'id,course_id,version_number,title,summary,status,markets(name)';

const versionOf = (r: Record<string, unknown>): VersionRow => ({
  id: text(r['id']),
  courseId: text(r['course_id']),
  versionNumber: intOrNull(r['version_number']) ?? 0,
  title: text(r['title']),
  summary: textOrNull(r['summary']),
  // The read rules never show a rep a draft; anything else is `published` or `retired`.
  status: r['status'] === 'retired' ? 'retired' : 'published',
  marketName: textOrNull(one(r['markets'])?.['name']),
});

const enrolmentOf = (r: Record<string, unknown>): EnrolmentRow => ({
  id: text(r['id']),
  versionId: text(r['course_version_id']),
  startedAt: text(r['started_at']),
  completedAt: textOrNull(r['completed_at']),
});

const versionsOf = async (c: LiveConnection, courseIds: readonly string[]) =>
  courseIds.length === 0
    ? []
    : (
        await selectRows(
          c,
          `course_versions?select=${VERSION_COLUMNS}&course_id=${inList(courseIds)}&order=version_number.desc`,
        )
      ).map(versionOf);

const enrolmentsOf = async (c: LiveConnection, versionIds: readonly string[]) =>
  versionIds.length === 0
    ? []
    : (
        await selectRows(
          c,
          `course_enrolments?select=id,course_version_id,started_at,completed_at&course_version_id=${inList(versionIds)}`,
        )
      ).map(enrolmentOf);

export const createLiveLearningBackend = (c: LiveConnection): LearningBackend => ({
  myCourses: async () => {
    // A cancelled assignment stays as history; it is not something the rep is asked to do.
    const rows = await selectRows(
      c,
      'course_assignments?select=id,course_id,due_on,courses(title)&cancelled_at=is.null&order=assigned_at',
    );
    const assignments = rows.map((r): AssignmentRow => ({
      id: text(r['id']),
      courseId: text(r['course_id']),
      courseTitle: text(one(r['courses'])?.['title']),
      dueOn: textOrNull(r['due_on']),
    }));
    const versions = await versionsOf(
      c,
      assignments.map((a) => a.courseId),
    );
    const enrolments = await enrolmentsOf(
      c,
      versions.map((v) => v.id),
    );
    return { assignments, versions, enrolments };
  },

  course: async (courseId) => {
    const [course] = await selectRows(c, `courses?select=title&id=eq.${courseId}`);
    const versions = await versionsOf(c, [courseId]);
    const enrolments = await enrolmentsOf(
      c,
      versions.map((v) => v.id),
    );
    return { title: course === undefined ? null : text(course['title']), versions, enrolments };
  },

  preview: async (versionId) => {
    const lessons = await selectRows(
      c,
      `lessons?select=id,estimated_minutes&course_version_id=eq.${versionId}`,
    );
    const estimates = lessons.map((r) => intOrNull(r['estimated_minutes']));
    return {
      lessons: lessons.length,
      minutes: estimates.every((m): m is number => m !== null)
        ? estimates.reduce((sum, m) => sum + m, 0)
        : null,
    };
  },

  outline: async (versionId, enrolmentId) => {
    const [modules, lessons, completions] = await Promise.all([
      selectRows(
        c,
        `course_modules?select=id,position,title&course_version_id=eq.${versionId}&order=position`,
      ),
      // The body is NOT read here: the outline lists titles, and a lesson is read when opened.
      selectRows(
        c,
        `lessons?select=id,module_id,position,title,estimated_minutes&course_version_id=eq.${versionId}&order=position`,
      ),
      selectRows(c, `lesson_completions?select=lesson_id&enrolment_id=eq.${enrolmentId}`),
    ]);
    return {
      modules: modules.map((r) => ({
        id: text(r['id']),
        position: intOrNull(r['position']) ?? 0,
        title: text(r['title']),
      })),
      lessons: lessons.map((r) => ({
        id: text(r['id']),
        moduleId: text(r['module_id']),
        position: intOrNull(r['position']) ?? 0,
        title: text(r['title']),
        estimatedMinutes: intOrNull(r['estimated_minutes']),
      })),
      completedLessonIds: new Set(completions.map((r) => text(r['lesson_id']))),
    };
  },

  lesson: async (lessonId, enrolmentId) => {
    const [row] = await selectRows(
      c,
      `lessons?select=id,course_version_id,title,body,estimated_minutes,video_object_path,video_poster_path,video_duration_seconds&id=eq.${lessonId}`,
    );
    if (row === undefined) return null;
    const [done] = await selectRows(
      c,
      `lesson_completions?select=completed_at&enrolment_id=eq.${enrolmentId}&lesson_id=eq.${lessonId}`,
    );
    return {
      id: text(row['id']),
      versionId: text(row['course_version_id']),
      title: text(row['title']),
      body: text(row['body']),
      estimatedMinutes: intOrNull(row['estimated_minutes']),
      completedAt: done === undefined ? null : textOrNull(done['completed_at']),
      video:
        textOrNull(row['video_object_path']) === null
          ? null
          : {
              objectPath: text(row['video_object_path']),
              posterPath: textOrNull(row['video_poster_path']),
              durationSeconds: intOrNull(row['video_duration_seconds']),
            },
    };
  },

  start: async (versionId) =>
    StartCourseVersionResponseSchema.parse(
      await callRpc(c, LMS_RPC.startCourseVersion, { p_course_version_id: versionId }),
    ),

  complete: async (enrolmentId, lessonId) =>
    CompleteLessonResponseSchema.parse(
      await callRpc(c, LMS_RPC.completeLesson, {
        p_enrolment_id: enrolmentId,
        p_lesson_id: lessonId,
      }),
    ),

  videoUrl: async (objectPath) => {
    try {
      return await createLessonVideoSignedUrl(c, objectPath);
    } catch (error) {
      // The server ANSWERED and refused: the same kind of failure as a refused table read.
      if (error instanceof LessonVideoUrlError) {
        throw new LiveRequestError(error.status, null, error.message);
      }
      throw error;
    }
  },
});
