import { describe, expect, it } from 'vitest';
import type { VersionRow } from './live';
import { courseFacts, courseState, previewVersionId, versionSummary } from './view';

/** `FE-W193` — what a course page says before the course is started. */
const version = (over: Partial<VersionRow> = {}): VersionRow => ({
  id: 'v1',
  courseId: 'c1',
  versionNumber: 1,
  title: 'Storage basics',
  summary: null,
  status: 'published',
  marketName: null,
  ...over,
});

describe('courseFacts', () => {
  it('counts the lessons and adds their length', () => {
    expect(courseFacts({ lessons: 6, minutes: 30 })).toBe('6 lessons · about 30 min');
    expect(courseFacts({ lessons: 1, minutes: 4 })).toBe('1 lesson · about 4 min');
  });

  it('FE-W198: an hour or more is hours and minutes, as the beat plan says it', () => {
    expect(courseFacts({ lessons: 9, minutes: 90 })).toBe('9 lessons · about 1 h 30 min');
    expect(courseFacts({ lessons: 4, minutes: 60 })).toBe('4 lessons · about 1 h');
  });

  it('without every estimate there is no length: a sum with gaps under-states the course', () => {
    expect(courseFacts({ lessons: 3, minutes: null })).toBe('3 lessons');
  });

  it('says nothing for no preview, or for a version with no lessons', () => {
    expect(courseFacts(null)).toBeNull();
    expect(courseFacts({ lessons: 0, minutes: 0 })).toBeNull();
  });
});

describe('previewVersionId and versionSummary', () => {
  it('previews the one version a not-started course would start', () => {
    const state = courseState('c1', [version()], []);
    expect(previewVersionId(state)).toBe('v1');
  });

  it('previews nothing when the rep must choose a market, or has started', () => {
    expect(
      previewVersionId(
        courseState('c1', [version({ marketName: 'India' }), version({ id: 'v2' })], []),
      ),
    ).toBeNull();
    expect(
      previewVersionId(
        courseState(
          'c1',
          [version()],
          [{ id: 'e1', versionId: 'v1', startedAt: '2026-10-07T09:00:00Z', completedAt: null }],
        ),
      ),
    ).toBeNull();
  });

  it('the summary is the company’s, trimmed; a blank one is none', () => {
    expect(versionSummary([version({ summary: '  Keep it cold. ' })], 'v1')).toBe('Keep it cold.');
    expect(versionSummary([version({ summary: '   ' })], 'v1')).toBeNull();
    expect(versionSummary([version({ summary: 'x' })], null)).toBeNull();
  });
});
