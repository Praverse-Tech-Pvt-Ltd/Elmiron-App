import { LiveRequestError } from '../live-rest';
import type { CompleteLessonResponse } from '@fieldforce/core';
import { t } from '@fieldforce/ui/i18n';
import { dayMonthOfDate } from '../today/territory-day';
import { durationLabel } from '../today/duration';
import type { AssignmentRow, CoursePreview, EnrolmentRow, OutlineRows, VersionRow } from './live';

/*
 * `FE-W183`. Every sentence below is read from the catalogue (`learning.*`) when it is asked for,
 * so it follows the app's language. Course and version titles and market names are the company's,
 * from the server, and are placed into those sentences as they came.
 */

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
      ? t('learning.finishProgress', {
          done: outcome.ok.lessonsCompleted,
          count: outcome.ok.lessonsTotal,
        })
      : t('learning.finishLast')
    : failureKind(outcome.failed) === 'offline'
      ? t('learning.finishOffline')
      : t('learning.finishRefused');

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
          ? v.marketName === null
            ? t('learning.versionNoMarket', { title: v.title })
            : t('learning.versionForMarket', { title: v.title, market: v.marketName })
          : v.title,
    })),
  };
};

/**
 * `FE-W193` — the one version a not-yet-started course would start, when there is exactly one. Its
 * summary and lesson count are shown above "Start this course". With a choice of markets nothing is
 * previewed: each version may hold different lessons, and one version's numbers under the course's
 * title would describe a course the rep may not choose.
 */
export const previewVersionId = (state: CourseState): string | null =>
  state.kind === 'can_start' && state.choices.length === 1
    ? (state.choices[0]?.versionId ?? null)
    : null;

/** The version's own summary, as the company wrote it, or null when it has none. */
export const versionSummary = (
  versions: readonly VersionRow[],
  versionId: string | null,
): string | null => {
  const summary = versions.find((v) => v.id === versionId)?.summary?.trim() ?? '';
  return summary === '' ? null : summary;
};

/**
 * `FE-W193` — "6 lessons · about 30 min", under a course's title before it is started. The length is
 * shown only when every lesson has an estimate: a sum with gaps would under-state the course.
 */
export const courseFacts = (preview: CoursePreview | null): string | null => {
  if (preview === null || preview.lessons === 0) return null;
  return [
    t('learning.courseLessons', { count: preview.lessons }),
    // `FE-W198`. "about 1 h 30 min", not "about 90 min".
    preview.minutes === null
      ? null
      : t('learning.aboutDuration', { duration: durationLabel(preview.minutes) }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
};

/**
 * `2026-10-15` → `Due 15 Oct`. A due date is a DATE: no clock and no zone are involved, so none is
 * used. `FE-W183`: named by `dayMonthOfDate`, so the month follows the app's language (`FE-W149`)
 * as every other date does; anything that is not exactly a date is still `null`, never a guess.
 */
export const dueLabel = (dueOn: string | null): string | null => {
  if (dueOn === null) return null;
  const date = dayMonthOfDate(dueOn);
  return date === null ? null : t('learning.due', { date });
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
          ? t('learning.startedOn', { date: day(state.startedAt) })
          : t('learning.finishedOn', { date: day(state.completedAt) })
        : state.kind === 'can_start'
          ? t('learning.notStarted')
          : t('learning.notAvailableYet');
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
