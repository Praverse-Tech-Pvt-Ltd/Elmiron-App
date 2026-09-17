import { describe, expect, it } from 'vitest';
import type { AuditLogEntry, ListAuditLogResponse } from '@fieldforce/core';
import {
  AUDIT_CAVEAT,
  AUDIT_HEADING,
  auditRows,
  emptyTrailNote,
  hiddenRowsNote,
  refusedNote,
} from './audit';

const ENTRY: AuditLogEntry = {
  id: 3,
  actorId: '00000000-0000-4000-8000-000000000001',
  actorRole: 'admin',
  action: 'select',
  tableName: 'consent_records',
  rowId: null,
  occurredAt: '2026-09-17T08:00:00.000Z',
  requestId: null,
  reason: 'quarterly compliance review',
};

const response = (over: Partial<ListAuditLogResponse> = {}): ListAuditLogResponse => ({
  data: [ENTRY],
  readAt: '2026-09-17T08:00:01.000Z',
  auditLogId: 4,
  systemRowsHidden: 0,
  ...over,
});

describe('FE-W13 — the audit panel does not claim to show attempts', () => {
  it('says SUCCESSFUL in the heading, because a refused read is not in the trail', () => {
    // `BE-W102`: all seven read paths audit-then-return inside one transaction, so a refusal
    // leaves nothing behind. The heading is asserted here rather than typed into JSX so that
    // the claim the screen makes is the claim this test constrains.
    expect(AUDIT_HEADING).toMatch(/successful/iu);
    expect(AUDIT_CAVEAT).toMatch(/refused read is not recorded/iu);
  });

  it('never describes an empty trail as an absence of attempts', () => {
    const note = emptyTrailNote();

    expect(note).toMatch(/does not mean there were no attempts/iu);
    // The negative control on the wording, stated as the property rather than as a regex
    // lookahead: the words "no attempts" may appear ONLY as part of the disclaimer. A panel
    // that said "no access attempts recorded" would contain the same words as a claim, which
    // is the default phrasing and the one that would be false.
    const lower = note.toLowerCase();
    const at = lower.indexOf('no attempts');
    expect(at).toBeGreaterThan(-1);
    expect(lower.slice(0, at)).toMatch(/does not mean there were $/u);
  });

  it('renders a REFUSAL as a refusal, not as an empty list', () => {
    // `list_audit_log` raises 42501 for a non-admin rather than returning an empty page, on
    // purpose: an empty list claims there is nothing to see; a refusal claims something about
    // who is asking. These two notes must not be interchangeable.
    expect(refusedNote()).toMatch(/refused/iu);
    expect(refusedNote()).not.toEqual(emptyTrailNote());
  });
});

describe('FE-W13 — the rows say what the server recorded', () => {
  it('puts the action in the reader’s words rather than the column’s', () => {
    expect(auditRows(response())[0]?.what).toBe('read consent_records');
  });

  it('shows a null role and a null reason as NOT RECORDED, not as blank', () => {
    // A blank cell reads as "nothing happened". A null means "not recorded", and on `reason`
    // in particular that is informative: the read paths require one, so its absence says the
    // row came from a trigger rather than from a person.
    const rows = auditRows(response({ data: [{ ...ENTRY, actorRole: null, reason: null }] }));

    expect(rows[0]?.actorRole).toBe('not recorded');
    expect(rows[0]?.reason).toBe('not recorded');
  });

  it('carries the reason through verbatim', () => {
    expect(auditRows(response())[0]?.reason).toBe('quarterly compliance review');
  });
});

describe('FE-W13 — a scoped page is distinguishable from an empty one', () => {
  it('explains hidden system rows, and counts them from the server', () => {
    expect(hiddenRowsNote(response({ systemRowsHidden: 4 }))).toMatch(/^4 row\(s\)/u);
    expect(hiddenRowsNote(response({ systemRowsHidden: 4 }))).toMatch(/no actor/iu);
  });

  it('says nothing when nothing was hidden — so the note means something when it appears', () => {
    expect(hiddenRowsNote(response({ systemRowsHidden: 0 }))).toBeNull();
  });
});
