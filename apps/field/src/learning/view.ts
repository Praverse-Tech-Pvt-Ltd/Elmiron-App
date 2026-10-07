import { LiveRequestError } from '../live-rest';
import type { CompleteLessonResponse } from '@fieldforce/core';
import type { AssignmentRow, EnrolmentRow, OutlineRows, VersionRow } from './live';

/**
 * A failed read or write, as the screen must describe it. The server ANSWERING no (any HTTP status,
 * `LiveRequestError`) is not "no signal"; only a request that got no answer at all is.
 */
export const failureKind = (error: unknown): 'offline' | 'error' =>
  error instanceof LiveRequestError ? 'error' : 'offline';

/**
 * What the lesson screen says after "I have finished this lesson", from the server's own answer —
 * or, when there was none, that NOTHING was recorded: `complete_lesson` is not queued on the phone.
 */
export const finishNotice = (
  outcome: { readonly ok: CompleteLessonResponse } | { readonly failed: unknown },
): string =>
  'ok' in outcome
    ? outcome.ok.courseCompletedAt === null
      ? `${String(outcome.ok.lessonsCompleted)} of ${String(outcome.ok.lessonsTotal)} lessons finished.`
      : 'That was the last lesson — the course is finished.'
    : failureKind(outcome.failed) === 'offline'
      ? 'No signal, so this was not recorded. Nothing is saved on the phone — try again when you have signal.'
      : 'The server did not record this lesson as finished. Try again; if it keeps happening, tell your manager.';

/**
 * W2-F B — what each of a rep's courses IS, decided from what the server returned and nothing else.
 *
 * **Which version a rep opens.** An assignment names a course, and a course can have one published
 * version per market. Nothing in the schema says which market a rep is in, so this never guesses:
 *
 * - **Already started** a version of this course (any status — a retired version is resumed, because
 *   what someone finishes must be what they began): that enrolment, the latest if more than one.
 * - **Not started**, one published version: that one.
 * - **Not started**, several published versions: each is offered, named by its market, and the rep
 *   chooses. The server lets any of them be started (`start_course_version`).
 * - **No published version**: nothing to start, and the screen says exactly that.
 */
export type CourseState =
  | {
      readonly kind: 'started';
      readonly enrolmentId: string;
      readonly versionId: string;
      readonly startedAt: string;
      readonly completedAt: string | null;
    }
  | {
      readonly kind: 'can_start';
      readonly choices: readonly { readonly versionId: string; readonly label: string }[];
    }
  | { readonly kind: 'nothing_published' };

export const courseState = (
  courseId: string,
  versions: readonly VersionRow[],
  enrolments: readonly EnrolmentRow[],
): CourseState => {
  const mine = versions.filter((v) => v.courseId === courseId);
  const ids = new Set(mine.map((v) => v.id));
  const started = enrolments
    .filter((e) => ids.has(e.versionId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (started !== undefined) {
    return {
      kind: 'started',
      enrolmentId: started.id,
      versionId: started.versionId,
      startedAt: started.startedAt,
      completedAt: started.completedAt,
    };
  }
  const published = mine.filter((v) => v.status === 'published');
  if (published.length === 0) return { kind: 'nothing_published' };
  return {
    kind: 'can_start',
    choices: published.map((v) => ({
      versionId: v.id,
      // A market is named only when there is a choice to make between markets.
      label:
        published.length > 1
          ? `${v.title} — ${v.marketName ?? 'not specific to a market'}`
          : v.title,
    })),
  };
};

/** `2026-10-15` → `15 Oct`. A due date is a DATE: no clock and no zone are involved, so none is used. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dueLabel = (dueOn: string | null): string | null => {
  if (dueOn === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dueOn);
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1];
  return match === null || month === undefined ? null : `Due ${String(Number(match[3]))} ${month}`;
};

export interface MyCourseItem {
  readonly courseId: string;
  readonly title: string;
  readonly due: string | null;
  /** One line, true of what the server said: finished, started, not started, or nothing to start. */
  readonly line: string;
}

/**
 * The rep's assigned courses, in the order they were assigned. `day` formats a server instant as a
 * day in the territory's zone (`dayMonthIn`); only the server's own stamps are ever formatted.
 */
export const myCourseItems = (
  data: {
    readonly assignments: readonly AssignmentRow[];
    readonly versions: readonly VersionRow[];
    readonly enrolments: readonly EnrolmentRow[];
  },
  day: (iso: string) => string,
): MyCourseItem[] =>
  data.assignments.map((a) => {
    const state = courseState(a.courseId, data.versions, data.enrolments);
    const line =
      state.kind === 'started'
        ? state.completedAt === null
          ? `Started ${day(state.startedAt)}`
          : `Finished ${day(state.completedAt)}`
        : state.kind === 'can_start'
          ? 'Not started'
          : 'Not available yet — no version of this course has been published';
    return { courseId: a.courseId, title: a.courseTitle, due: dueLabel(a.dueOn), line };
  });

export interface OutlineSection {
  readonly title: string;
  readonly lessons: readonly {
    readonly id: string;
    readonly title: string;
    readonly minutes: number | null;
    readonly done: boolean;
  }[];
}

/** Modules in order, each with its lessons in order; `done` only where the server holds a completion. */
export const outlineSections = (
  rows: OutlineRows,
): { sections: OutlineSection[]; done: number; total: number } => {
  const sections = [...rows.modules]
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      title: m.title,
      lessons: rows.lessons
        .filter((l) => l.moduleId === m.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          id: l.id,
          title: l.title,
          minutes: l.estimatedMinutes,
          done: rows.completedLessonIds.has(l.id),
        })),
    }));
  const total = rows.lessons.length;
  const done = rows.lessons.filter((l) => rows.completedLessonIds.has(l.id)).length;
  return { sections, done, total };
};
