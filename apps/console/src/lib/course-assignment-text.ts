/**
 * W2-G B — what the assignment screen says when `assign_course` refuses, in the admin's words.
 *
 * **The refusals matter more than the happy path** (`20260924000500_lms_core.sql`, `assign_course`):
 *
 * - `22023` — the course has no published version, so there is nothing for anyone to take. W2-F found
 *   this rule only because a test fixture was refused; the screen must SAY it, not fail.
 * - `42501` — three different reasons share the code, and the function names each in its message:
 *   the caller is not an admin or field manager; the person is outside the caller's scope; the course
 *   belongs to another company. Each gets its own sentence.
 *
 * Pure, and outside the `'use client'` file, so it is tested without a renderer and is safe to call
 * from a server component.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

export const assignRefusal = ({ code, message }: Refusal): string => {
  if (code === '22023' && /no published version/u.test(message)) {
    return 'This course has no published version yet, so there is nothing to take. Publish a version first, then assign it.';
  }
  if (code === '42501') {
    if (/only an admin or a field manager/u.test(message)) {
      return 'Only an admin or a field manager can assign a course. Nothing was assigned.';
    }
    if (/not in your scope/u.test(message)) {
      return 'You can assign a course only to people in your team. Nothing was assigned.';
    }
    if (/not in your organisation/u.test(message)) {
      return 'That course is not one of your company’s. Nothing was assigned.';
    }
  }
  // Anything else is the server's own sentence, unsoftened.
  return `The server did not assign this: ${message}`;
};

/** The course's line in the picker: whether it can be taken, said before anyone presses Assign. */
export const courseOptionLabel = (title: string, published: boolean): string =>
  published ? title : `${title} — no published version, cannot be assigned yet`;
