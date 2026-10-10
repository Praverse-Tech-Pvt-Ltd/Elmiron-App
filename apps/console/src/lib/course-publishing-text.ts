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

/** What may be done to a version, from its status alone; the server checks again. */
export const versionAction = (status: CourseVersionStatus): 'publish' | 'retire' | null =>
  status === 'draft' ? 'publish' : status === 'published' ? 'retire' : null;
