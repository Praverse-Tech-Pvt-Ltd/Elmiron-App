import { describe, expect, it } from 'vitest';
import { assignRefusal, courseOptionLabel } from './course-assignment-text.js';

/**
 * W2-G B — each `assign_course` refusal, as the server words it (`lms_core.sql`), gets a sentence
 * that says WHY; the three `42501` reasons are told apart, and anything unknown is the server's own.
 */
describe('assign_course refusals, in words', () => {
  it('no published version (22023): says there is nothing to take and what to do', () => {
    expect(
      assignRefusal({ code: '22023', message: 'course 6b0… has no published version to take' }),
    ).toBe(
      'This course has no published version yet, so there is nothing to take. Publish a version first, then assign it.',
    );
  });

  it('the three 42501 reasons are three sentences', () => {
    expect(
      assignRefusal({
        code: '42501',
        message: 'only an admin or a field manager assigns a course',
      }),
    ).toMatch(/^Only an admin or a field manager can assign a course/u);
    expect(assignRefusal({ code: '42501', message: 'user 1a2… is not in your scope' })).toMatch(
      /^You can assign a course only to people in your team/u,
    );
    expect(
      assignRefusal({ code: '42501', message: 'course 6b0… is not in your organisation' }),
    ).toMatch(/^That course is not one of your company’s/u);
  });

  it('anything else is the server’s own sentence, not a guess', () => {
    expect(assignRefusal({ code: '23505', message: 'duplicate key' })).toBe(
      'The server did not assign this: duplicate key',
    );
    // A 22023 for a different reason is not called "no published version".
    expect(assignRefusal({ code: '22023', message: 'something else' })).toBe(
      'The server did not assign this: something else',
    );
  });

  it('a course that cannot be assigned says so in the picker, before anyone presses Assign', () => {
    expect(courseOptionLabel('Storage basics', true)).toBe('Storage basics');
    expect(courseOptionLabel('Draft only', false)).toBe(
      'Draft only — no published version, cannot be assigned yet',
    );
  });
});
