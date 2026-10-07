import { describe, expect, it } from 'vitest';
import { LiveRequestError } from '../live-rest';
import type { EnrolmentRow, VersionRow } from './live';
import {
  courseState,
  dueLabel,
  failureKind,
  finishNotice,
  myCourseItems,
  outlineSections,
} from './view';

const C = 'course-1';
const version = (over: Partial<VersionRow> = {}): VersionRow => ({
  id: 'v1',
  courseId: C,
  versionNumber: 1,
  title: 'Storage basics',
  summary: null,
  status: 'published',
  marketName: null,
  ...over,
});
const enrolment = (over: Partial<EnrolmentRow> = {}): EnrolmentRow => ({
  id: 'e1',
  versionId: 'v1',
  startedAt: '2026-10-07T09:00:00+00:00',
  completedAt: null,
  ...over,
});

describe('W2-F B — which version a rep opens, from the server’s rows only', () => {
  it('one published version, not started: that one, named by its title alone', () => {
    expect(courseState(C, [version()], [])).toEqual({
      kind: 'can_start',
      choices: [{ versionId: 'v1', label: 'Storage basics' }],
    });
  });

  it('several published versions: each offered and NAMED BY MARKET — the schema gives a rep no market', () => {
    const state = courseState(
      C,
      [version({ id: 'v1', marketName: 'India' }), version({ id: 'v2', marketName: null })],
      [],
    );
    expect(state).toEqual({
      kind: 'can_start',
      choices: [
        { versionId: 'v1', label: 'Storage basics — India' },
        { versionId: 'v2', label: 'Storage basics — not specific to a market' },
      ],
    });
  });

  it('a started course RESUMES its pinned version, even once retired — what is finished is what was begun', () => {
    const state = courseState(
      C,
      [version({ id: 'v1', status: 'retired' }), version({ id: 'v2', versionNumber: 2 })],
      [enrolment({ versionId: 'v1' })],
    );
    expect(state).toMatchObject({ kind: 'started', versionId: 'v1', enrolmentId: 'e1' });
  });

  it('of two enrolments, the latest started is the one shown', () => {
    const state = courseState(
      C,
      [version({ id: 'v1' }), version({ id: 'v2' })],
      [
        enrolment({ id: 'old', versionId: 'v1', startedAt: '2026-09-01T09:00:00+00:00' }),
        enrolment({ id: 'new', versionId: 'v2', startedAt: '2026-10-01T09:00:00+00:00' }),
      ],
    );
    expect(state).toMatchObject({ kind: 'started', enrolmentId: 'new' });
  });

  it('only retired versions and no enrolment: nothing to start — said, not guessed', () => {
    expect(courseState(C, [version({ status: 'retired' })], [])).toEqual({
      kind: 'nothing_published',
    });
    expect(courseState(C, [], [])).toEqual({ kind: 'nothing_published' });
  });

  it('another course’s versions and enrolments move nothing', () => {
    const state = courseState(
      C,
      [version({ id: 'x', courseId: 'other' })],
      [enrolment({ versionId: 'x' })],
    );
    expect(state).toEqual({ kind: 'nothing_published' });
  });
});

describe('the list’s lines are true of what the server said', () => {
  const day = (iso: string) => `D${iso.slice(5, 10)}`;
  const data = (versions: VersionRow[], enrolments: EnrolmentRow[]) => ({
    assignments: [{ id: 'a1', courseId: C, courseTitle: 'Storage basics', dueOn: '2026-10-15' }],
    versions,
    enrolments,
  });

  it('not started / started / finished / nothing published', () => {
    expect(myCourseItems(data([version()], []), day)[0]?.line).toBe('Not started');
    expect(myCourseItems(data([version()], [enrolment()]), day)[0]?.line).toBe('Started D10-07');
    expect(
      myCourseItems(
        data([version()], [enrolment({ completedAt: '2026-10-08T05:00:00+00:00' })]),
        day,
      )[0]?.line,
    ).toBe('Finished D10-08');
    expect(myCourseItems(data([], []), day)[0]?.line).toBe(
      'Not available yet — no version of this course has been published',
    );
  });

  it('a due date is a date: no zone moves it', () => {
    expect(dueLabel('2026-10-15')).toBe('Due 15 Oct');
    expect(dueLabel('2026-01-01')).toBe('Due 1 Jan');
    expect(dueLabel(null)).toBeNull();
    expect(dueLabel('15/10/2026')).toBeNull();
  });
});

describe('the outline', () => {
  it('modules and lessons in POSITION order, done only where the server holds a completion', () => {
    const out = outlineSections({
      modules: [
        { id: 'm2', position: 2, title: 'Two' },
        { id: 'm1', position: 1, title: 'One' },
      ],
      lessons: [
        { id: 'l2', moduleId: 'm1', position: 2, title: 'B', estimatedMinutes: null },
        { id: 'l1', moduleId: 'm1', position: 1, title: 'A', estimatedMinutes: 5 },
        { id: 'l3', moduleId: 'm2', position: 1, title: 'C', estimatedMinutes: 3 },
      ],
      completedLessonIds: new Set(['l2']),
    });
    expect(out.sections.map((s) => [s.title, s.lessons.map((l) => [l.id, l.done])])).toEqual([
      [
        'One',
        [
          ['l1', false],
          ['l2', true],
        ],
      ],
      ['Two', [['l3', false]]],
    ]);
    expect([out.done, out.total]).toEqual([1, 3]);
  });
});

describe('a failure is described as what it was', () => {
  it('the server answering is not "no signal"; no answer is', () => {
    expect(failureKind(new LiveRequestError(403, '42501', 'no'))).toBe('error');
    expect(failureKind(new TypeError('Network request failed'))).toBe('offline');
  });

  it('after "finished": the server’s counts, the course finished only on its stamp, nothing claimed offline', () => {
    const ok = {
      enrolmentId: 'e1',
      lessonId: 'l1',
      lessonCompletedAt: '2026-10-07T09:10:00+00:00',
      lessonsCompleted: 1,
      lessonsTotal: 3,
      courseCompletedAt: null,
    };
    expect(finishNotice({ ok })).toBe('1 of 3 lessons finished.');
    expect(finishNotice({ ok: { ...ok, courseCompletedAt: '2026-10-07T09:10:00+00:00' } })).toBe(
      'That was the last lesson — the course is finished.',
    );
    expect(finishNotice({ failed: new TypeError('Network request failed') })).toContain(
      'not recorded',
    );
    expect(finishNotice({ failed: new LiveRequestError(500, null, 'x') })).toContain(
      'did not record',
    );
  });
});
