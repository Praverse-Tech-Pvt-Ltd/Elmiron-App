import { describe, expect, it } from 'vitest';
import { adverseEventListArgs } from '@fieldforce/core';
import {
  NOT_ADMIN_NOTE,
  ROUTING_NOTE,
  adverseRefusal,
  cursorFrom,
  deadline,
  olderHref,
  reporterLabel,
  sourceLabel,
  timeLeft,
  visitDayLabel,
} from './adverse-events-text';
import { reasonLabel } from './labels';

describe('FE-W204 — a side-effect flag in an admin’s words', () => {
  it('names the source and who flagged it, and a detection names nobody', () => {
    expect(sourceLabel('mr_reported')).toBe('Reported by a rep');
    expect(sourceLabel('transcript_detected')).toBe('Found in a transcript');
    expect(reporterLabel({ source: 'mr_reported', reportedByName: 'Rep 1 (Pune)' })).toBe(
      'Rep 1 (Pune)',
    );
    expect(reporterLabel({ source: 'transcript_detected', reportedByName: null })).toBe(
      'Nobody: found in a transcript',
    );
    expect(visitDayLabel('2026-10-14')).toBe('14 Oct 2026');
    expect(visitDayLabel(null)).toBe('Not recorded');
  });

  it('says the deadline in India time, with what is left, or that it has passed', () => {
    expect(
      deadline({ statutoryDueAt: '2026-10-29T12:35:00Z', hoursRemaining: 342, overdue: false }),
    ).toEqual({ when: 'Due 29 Oct 2026, 18:05', left: '14 days, 6 hours left', overdue: false });
    expect(
      deadline({ statutoryDueAt: '2026-10-01T04:30:00Z', hoursRemaining: -5, overdue: true }),
    ).toEqual({ when: 'Was due 1 Oct 2026, 10:00', left: null, overdue: true });
    expect(timeLeft(1)).toBe('1 hour left');
    expect(timeLeft(24)).toBe('1 day left');
    expect(timeLeft(49)).toBe('2 days, 1 hour left');
    expect(timeLeft(0)).toBeNull();
  });

  it('puts the routing rule in the fixed note, and tells a manager whose these are', () => {
    expect(ROUTING_NOTE).toBe(
      'Until your company names a pharmacovigilance contact, admins receive these flags. Pass each one to your safety team within its deadline.',
    );
    expect(
      adverseRefusal({ code: '42501', message: 'only an admin may read the adverse-event clock' }),
    ).toBe(NOT_ADMIN_NOTE);
    expect(
      adverseRefusal({ message: 'admin access to an adverse-event report requires a reason' }),
    ).toMatch(/Say why/u);
    expect(adverseRefusal({ message: 'something new' })).toBe(
      'The server refused this: something new',
    );
  });

  it('names the screen’s own audited read in the audit log', () => {
    expect(reasonLabel('console side-effect flags screen')).toBe('Opened Side-effect flags');
  });
});

describe('FE-W204 — paging passes the cursor back exactly as the server sent it', () => {
  // Microseconds: a `Date` would keep three of the six digits and skip rows at the boundary.
  const AT = '2026-10-14T12:35:00.123456+00:00';
  const ID = 'a1b2c3d4-0000-4000-8000-000000000001';

  it('builds the older-page link without touching the timestamp', () => {
    const href = olderHref({ nextBeforeReceivedAt: AT, nextBeforeId: ID });
    expect(href).not.toBeNull();
    const query = new URLSearchParams((href ?? '').split('?')[1]);
    expect(query.get('before')).toBe(AT);
    expect(query.get('beforeId')).toBe(ID);
    expect(olderHref({ nextBeforeReceivedAt: null, nextBeforeId: null })).toBeNull();
  });

  it('reads the cursor back from the URL, both or neither, and hands core the same strings', () => {
    const cursor = cursorFrom(AT, ID);
    expect(cursor).toEqual({ nextBeforeReceivedAt: AT, nextBeforeId: ID });
    expect(adverseEventListArgs('r', { after: cursor })).toMatchObject({
      p_before_received_at: AT,
      p_before_id: ID,
    });
    expect(cursorFrom(AT, undefined)).toBeNull();
    expect(cursorFrom('yesterday', ID)).toBeNull();
    expect(cursorFrom(AT, 'not-an-id')).toBeNull();
  });
});
