import { describe, expect, it } from 'vitest';
import {
  publishRefusal,
  versionAction,
  videoLessonsLine,
  videoTotal,
} from './course-publishing-text';

/** Each message is the database's own text (`20260924000500_lms_core.sql`). */
describe('course publishing refusals', () => {
  it('names each refusal', () => {
    expect(
      publishRefusal({ code: '42501', message: 'only an admin publishes a course version' }),
    ).toMatch(/Only an admin/u);
    expect(publishRefusal({ code: '22023', message: 'course version v has no lessons' })).toMatch(
      /no lessons yet/u,
    );
    expect(
      publishRefusal({ code: '22023', message: 'course version v is already published' }),
    ).toMatch(/no longer a draft/u);
    expect(publishRefusal({ code: '22023', message: 'course version v is not published' })).toMatch(
      /Only a published/u,
    );
    expect(
      publishRefusal({ code: '42501', message: 'course version v is not in your organisation' }),
    ).toMatch(/not one of your company/u);
  });

  it('passes the unforeseen through', () => {
    expect(publishRefusal({ message: 'new thing' })).toBe('The server refused this: new thing');
  });

  it('offers publish for a draft, retire for a published version, nothing for a retired one', () => {
    expect(versionAction('draft')).toBe('publish');
    expect(versionAction('published')).toBe('retire');
    expect(versionAction('retired')).toBeNull();
  });
});

describe('FE-W128 — which lessons carry a video', () => {
  it('names each video lesson with its length, and invents none', () => {
    expect(videoLessonsLine([])).toBe('None');
    expect(
      videoLessonsLine([
        { lesson: 'Phenotyping', seconds: 754 },
        { lesson: 'Cystoscopy', seconds: null },
      ]),
    ).toBe('Phenotyping (12:34) · Cystoscopy (length not measured)');
    expect(
      videoTotal([
        { lesson: 'A', seconds: 3000 },
        { lesson: 'B', seconds: 723 },
      ]),
    ).toBe('1:02:03');
    expect(videoTotal([{ lesson: 'A', seconds: null }])).toBeNull();
    expect(videoTotal([])).toBeNull();
  });
});
