import {
  CompleteLessonResponseSchema,
  LMS_RPC,
  StartCourseVersionResponseSchema,
} from '@fieldforce/core';
import type { CompleteLessonResponse, StartCourseVersionResponse } from '@fieldforce/core';
import { callRpc, selectRows } from '../live-rest';
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

export interface LessonRow {
  readonly id: string;
  readonly versionId: string;
  readonly title: string;
  readonly body: string;
  readonly estimatedMinutes: number | null;
  /** When the server recorded this enrolment finishing it, or null. */
  readonly completedAt: string | null;
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
  /** One version's modules and lessons (titles only), and what this enrolment has completed. */
  outline(versionId: string, enrolmentId: string): Promise<OutlineRows>;
  /** One lesson in full, with whether this enrolment has completed it; null if not readable. */
  lesson(lessonId: string, enrolmentId: string): Promise<LessonRow | null>;
  start(versionId: string): Promise<StartCourseVersionResponse>;
  complete(enrolmentId: string, lessonId: string): Promise<CompleteLessonResponse>;
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
      `lessons?select=id,course_version_id,title,body,estimated_minutes&id=eq.${lessonId}`,
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
});
