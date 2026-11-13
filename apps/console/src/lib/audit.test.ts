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
  it('says every row SUCCEEDED, because a refused read is not in the trail', () => {
    // `BE-W102`: all seven read paths audit-then-return inside one transaction, so a refusal
    // leaves nothing behind. `FE-W165` moved the claim from the heading ("Successful reads", over
    // rows that were mostly creations) into the caveat, where it is asserted here.
    expect(AUDIT_HEADING).toBe('Recent activity');
    expect(AUDIT_CAVEAT).toMatch(/succeeded/iu);
    // `FE-W214`: a refusal IS recorded (`20260924000300`); this panel does not ask for it.
    expect(AUDIT_CAVEAT).toMatch(/refused read is recorded too, but it is not shown here/iu);
    expect(AUDIT_CAVEAT).not.toMatch(/not recorded/iu);
    expect(emptyTrailNote()).not.toMatch(/not recorded/iu);
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
  it('puts the action and the record in the reader’s words rather than the column’s', () => {
    expect(auditRows(response())[0]?.what).toBe('Read · Consent record');
  });

  it('shows a null reason as an absence, not as a blank', () => {
    // A blank cell reads as "nothing happened". A null means "not recorded", and on `reason`
    // in particular that is informative: the read paths require one, so its absence says the
    // row came from a trigger rather than from a person.
    const rows = auditRows(response({ data: [{ ...ENTRY, actorRole: null, reason: null }] }));

    expect(rows[0]?.actorRole).toBeNull();
    expect(rows[0]?.reason).toBe('—');
  });

  it('names the screen that was opened in place of the console’s own read reason', () => {
    const rows = auditRows(
      response({
        data: [{ ...ENTRY, reason: 'console admin screen — compliance panel render' }],
      }),
    );
    expect(rows[0]?.reason).toBe('Opened Consent versions');
  });

  it('carries the reason through verbatim', () => {
    expect(auditRows(response())[0]?.reason).toBe('quarterly compliance review');
  });
});

describe('FE-W13 — a scoped page is distinguishable from an empty one', () => {
  it('explains hidden system rows, and counts them from the server', () => {
    expect(hiddenRowsNote(response({ systemRowsHidden: 4 }))).toBe(
      '4 entries made by the system itself, not by a person, are not shown: they belong to no company.',
    );
    expect(hiddenRowsNote(response({ systemRowsHidden: 1 }))).toMatch(/^1 entry .* is not shown/u);
  });

  it('says nothing when nothing was hidden — so the note means something when it appears', () => {
    expect(hiddenRowsNote(response({ systemRowsHidden: 0 }))).toBeNull();
  });
});
