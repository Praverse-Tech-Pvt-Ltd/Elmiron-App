/**
 * LMS admin flow — what the Courses screen says when `publish_course_version` or
 * `retire_course_version` refuses (`20260924000500_lms_core.sql`). Pure, so it is tested without a
 * renderer. Anything unforeseen is the server's own sentence, unsoftened.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

export const publishRefusal = ({ message }: Refusal): string => {
  if (/only an admin (publishes|retires)/u.test(message)) {
    return 'Only an admin publishes or retires a course. Nothing changed.';
  }
  if (/is not in your organisation/u.test(message)) {
    return 'That course is not one of your company’s. Nothing changed.';
  }
  if (/has no lessons/u.test(message)) {
    return 'This version has no lessons yet, so there is nothing for anyone to take. Load its lessons first.';
  }
  if (/is already/u.test(message)) {
    return 'This version is no longer a draft — reload the page to see where it stands.';
  }
  if (/is not published/u.test(message)) {
    return 'Only a published version can be retired.';
  }
  return `The server refused this: ${message}`;
};

export type CourseVersionStatus = 'draft' | 'published' | 'retired';

/** `FE-W128` — one lesson of a version that carries a video (`BE-W208`), with its measured length. */
export interface VideoLesson {
  readonly lesson: string;
  /** Seconds, as the loader's ffprobe measured them; null when it could not. */
  readonly seconds: number | null;
}

const clock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`;
};

/**
 * `FE-W128` — which lessons of a version carry a video, and how long each is: "None", or each lesson
 * with its length ("length not measured" when the loader had no ffprobe). Nothing is invented.
 */
export const videoLessonsLine = (videos: readonly VideoLesson[]): string =>
  videos.length === 0
    ? 'None'
    : videos
        .map(
          (v) => `${v.lesson} (${v.seconds === null ? 'length not measured' : clock(v.seconds)})`,
        )
        .join(' · ');

/** The total running time of a version's videos, for the column's figure; null when none is measured. */
export const videoTotal = (videos: readonly VideoLesson[]): string | null => {
  const measured = videos.filter((v) => v.seconds !== null);
  return measured.length === 0 ? null : clock(measured.reduce((n, v) => n + (v.seconds ?? 0), 0));
};

/** What may be done to a version, from its status alone; the server checks again. */
export const versionAction = (status: CourseVersionStatus): 'publish' | 'retire' | null =>
  status === 'draft' ? 'publish' : status === 'published' ? 'retire' : null;
