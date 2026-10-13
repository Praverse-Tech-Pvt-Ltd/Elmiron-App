import { describe, expect, it } from 'vitest';
import type { CompanyNoticeVersion } from '@fieldforce/core';
import {
  BODY_MAX,
  BODY_MIN,
  LABEL_MAX,
  REACCEPT_NOTE,
  approvalAffordance,
  attestationProblem,
  blankWarning,
  noticeRefusal,
  proposalProblem,
  statusLabel,
  statusTone,
  when,
} from './tracking-notice-text';

const version = (over: Partial<CompanyNoticeVersion> = {}): CompanyNoticeVersion => ({
  id: 'dd9ca1e9-c2c4-42f6-bf6a-4d24895a36e9',
  versionLabel: 'v1',
  body: 'The company notice text. '.repeat(3),
  createdAt: '2026-10-13T07:10:15.70199+00:00',
  authorName: 'DEMO Admin',
  authoredByYou: false,
  status: 'waiting',
  approvedAt: null,
  approverName: null,
  attestation: null,
  ...over,
});

describe('FE-W91 — the live location notice screen’s words', () => {
  it('names each status the server sends, with a tone', () => {
    expect(statusLabel('waiting')).toBe('Waiting for a second admin');
    expect(statusLabel('in_force')).toBe('In force');
    expect(statusLabel('superseded')).toBe('Replaced by a later version');
    expect(statusTone('in_force')).toBe('success');
    expect(statusTone('waiting')).toBe('attention');
  });

  it('four eyes: the author is told to wait for a second admin; another admin may approve', () => {
    const mine = approvalAffordance(version({ authoredByYou: true }));
    expect(mine.kind).toBe('waiting_for_another');
    expect(mine.kind === 'waiting_for_another' ? mine.reason : '').toMatch(
      /Waiting for a second admin/u,
    );
    expect(approvalAffordance(version()).kind).toBe('may_approve');
    // Nothing to approve once a version is in force or replaced, whoever is looking.
    expect(approvalAffordance(version({ status: 'in_force' })).kind).toBe('none');
    expect(approvalAffordance(version({ status: 'superseded', authoredByYou: true })).kind).toBe(
      'none',
    );
  });

  it('holds the table’s limits on a label and a text, and passes a good one', () => {
    const body = 'x'.repeat(BODY_MIN);
    expect(proposalProblem('', body)).toMatch(/label/u);
    expect(proposalProblem('   ', body)).toMatch(/label/u);
    expect(proposalProblem('x'.repeat(LABEL_MAX + 1), body)).toMatch(/at most 80/u);
    expect(proposalProblem('v1', 'x'.repeat(BODY_MIN - 1))).toMatch(/at least 50/u);
    // Trimmed, as the table's check is: fifty spaces are not a notice.
    expect(proposalProblem('v1', ` ${'x'.repeat(BODY_MIN - 1)} `)).toMatch(/at least 50/u);
    expect(proposalProblem('v1', 'x'.repeat(BODY_MAX + 1))).toMatch(/at most 20000/u);
    expect(proposalProblem('v1', body)).toBeNull();
    expect(proposalProblem('x'.repeat(LABEL_MAX), 'x'.repeat(BODY_MAX))).toBeNull();
  });

  it('warns, without refusing, about a [[ BLANK ]] left from the draft', () => {
    expect(blankWarning('From: [[ BLANK: registered legal name ]]')).toMatch(/BLANK/u);
    expect(blankWarning('From: Elmiron Pharma Pvt Ltd')).toBeNull();
    expect(proposalProblem('v1', `[[ BLANK ]] ${'x'.repeat(BODY_MIN)}`)).toBeNull();
  });

  it('asks for an attestation of 3 to 500 characters', () => {
    expect(attestationProblem('ok')).toMatch(/what you checked/u);
    expect(attestationProblem('x'.repeat(501))).toMatch(/at most 500/u);
    expect(attestationProblem('Read against the HR policy.')).toBeNull();
  });

  it('says that approving makes every rep accept again', () => {
    expect(REACCEPT_NOTE).toMatch(/every rep must read and accept it again/u);
  });

  it('shows times in India time', () => {
    expect(when('2026-10-13T07:10:15.70199+00:00')).toBe('13 Oct 2026, 12:40');
  });

  it('names every refusal the database makes, with its remedy', () => {
    // Messages exactly as `20261013000100_live_tracking` and `20261013000600` raise them.
    const cases: [string | null, string, RegExp][] = [
      ['42501', 'only an admin loads a notice', /Only an admin/u],
      ['42501', 'only an admin approves a notice', /Only an admin/u],
      ['42501', 'only an admin manages the live tracking notice', /Only an admin/u],
      ['42501', 'the author of a notice may not approve it', /Ask a second admin/u],
      [
        '42501',
        "the engineering draft cannot be approved; load the company's own text",
        /Load your company’s own text/u,
      ],
      ['42501', "only an active admin of the notice's own company approves it", /active admin/u],
      ['42501', "notice version 1 is not your company's", /another company/u],
      [
        '23505',
        'duplicate key value violates unique constraint "live_tracking_notice_label_once"',
        /different label/u,
      ],
      [
        '23505',
        'duplicate key value violates unique constraint "live_tracking_notice_approvals_notice_version_id_key"',
        /already approved/u,
      ],
      [
        '23514',
        'new row for relation "live_tracking_notice_versions" violates check constraint "live_tracking_notice_versions_body_check"',
        /50 to 20000/u,
      ],
      [
        '23514',
        'new row for relation "live_tracking_notice_versions" violates check constraint "live_tracking_notice_versions_version_label_check"',
        /1 to 80/u,
      ],
      [
        '23514',
        'new row for relation "live_tracking_notice_approvals" violates check constraint "live_tracking_notice_approvals_attestation_check"',
        /what you checked/u,
      ],
      ['28000', 'not authenticated', /Sign in again/u],
    ];
    for (const [code, message, expected] of cases) {
      expect(noticeRefusal({ code, message }), message).toMatch(expected);
    }
    expect(noticeRefusal({ message: 'something new' })).toBe(
      'The server refused this: something new',
    );
  });
});
