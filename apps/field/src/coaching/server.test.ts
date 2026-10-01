import { describe, expect, it } from 'vitest';
import { listConsentForVisit, listMyAnalyses, readMyAnalysis, respondToMyAnalysis } from './server';
import type { RpcCaller } from '../capture/client';

/**
 * FE-D16 — the coaching reads and the reply, against the real functions on `main`:
 * `list_analyses`, `read_analysis`, `list_consent_records` (latest:
 * `20260923000100_console_reads_contract_shape.sql`) and `respond_to_analysis`
 * (`20260811000300_audit_log.sql:461`).
 *
 * Every response is parsed with `packages/core`'s own schema. One that does not parse is reported
 * as a mismatch, never reshaped in the app to fit.
 */

const ANALYSIS_ID = '55555555-5555-4555-8555-555555555511';
const VISIT_ID = '55555555-5555-4555-8555-555555555501';

const analysis = {
  id: ANALYSIS_ID,
  visitId: VISIT_ID,
  mrId: '55555555-5555-4555-8555-5555555555aa',
  transcriptId: null,
  status: 'completed',
  refusalReason: null,
  rubricVersion: 'r1',
  modelProvider: 'fixture',
  modelVersion: 'v0',
  findings: [],
  mrViewedAt: null,
  mrResponse: null,
  mrRespondedAt: null,
  generatedAt: '2026-10-01T09:00:00+00:00',
  createdAt: '2026-10-01T09:00:00+00:00',
};

const envelope = (data: unknown) => ({
  data,
  readAt: '2026-10-01T09:30:00+00:00',
  auditLogId: 42,
});

const rpc = (
  reply: { data: unknown; error: { code?: string; message: string } | null },
  calls: { fn: string; args: Record<string, unknown> }[] = [],
): RpcCaller => ({
  rpc: (fn, args) => {
    calls.push({ fn, args });
    return Promise.resolve(reply);
  },
});

describe('listMyAnalyses — list_analyses', () => {
  it('calls the real function with no reason (an MR needs none) and returns the parsed list', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const outcome = await listMyAnalyses(rpc({ data: envelope([analysis]), error: null }, calls));

    expect(calls).toEqual([{ fn: 'list_analyses', args: { p_mr_id: null, p_reason: null } }]);
    expect(outcome.kind).toBe('loaded');
    expect(outcome.kind === 'loaded' ? outcome.value.map((a) => a.id) : []).toEqual([ANALYSIS_ID]);
  });

  it('an empty list is loaded and empty, not an error', async () => {
    const outcome = await listMyAnalyses(rpc({ data: envelope([]), error: null }));
    expect(outcome).toEqual({ kind: 'loaded', value: [] });
  });

  it('a refusal is a refusal, with its SQLSTATE', async () => {
    const outcome = await listMyAnalyses(
      rpc({ data: null, error: { code: '42501', message: 'no' } }),
    );
    expect(outcome.kind).toBe('refused');
  });

  it('a response that is not the contract is a MISMATCH, never reshaped', async () => {
    const outcome = await listMyAnalyses(rpc({ data: { items: [analysis] }, error: null }));
    expect(outcome.kind).toBe('mismatch');
  });
});

describe('readMyAnalysis — read_analysis', () => {
  it('returns the analysis', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const outcome = await readMyAnalysis(
      ANALYSIS_ID,
      rpc({ data: envelope(analysis), error: null }, calls),
    );

    expect(calls[0]).toEqual({
      fn: 'read_analysis',
      args: { p_analysis_id: ANALYSIS_ID, p_reason: null },
    });
    expect(outcome.kind === 'loaded' ? outcome.value?.id : null).toBe(ANALYSIS_ID);
  });

  it('an analysis out of scope arrives as data: null, and stays null', async () => {
    const outcome = await readMyAnalysis(ANALYSIS_ID, rpc({ data: envelope(null), error: null }));
    expect(outcome).toEqual({ kind: 'loaded', value: null });
  });
});

describe('listConsentForVisit — list_consent_records', () => {
  it('asks for that visit only', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    await listConsentForVisit(VISIT_ID, rpc({ data: envelope([]), error: null }, calls));
    expect(calls[0]).toEqual({
      fn: 'list_consent_records',
      args: { p_visit_id: VISIT_ID, p_reason: null },
    });
  });
});

describe('respondToMyAnalysis — respond_to_analysis', () => {
  it('sends the trimmed reply and reports it sent', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    // The function returns a raw snake_case row (audit_log.sql:496), which is NOT the Analysis
    // contract. The app does not parse it, and does not reshape it: it only needs to know the
    // write landed. FE-CR-10 asks backend about the return shape.
    const outcome = await respondToMyAnalysis(
      ANALYSIS_ID,
      '  I did answer the objection.  ',
      rpc({ data: { id: ANALYSIS_ID, mr_response: 'x' }, error: null }, calls),
    );

    expect(calls[0]).toEqual({
      fn: 'respond_to_analysis',
      args: { p_analysis_id: ANALYSIS_ID, p_response: 'I did answer the objection.' },
    });
    expect(outcome).toEqual({ kind: 'sent' });
  });

  it('a refusal (not your analysis) is a refusal', async () => {
    const outcome = await respondToMyAnalysis(
      ANALYSIS_ID,
      'x',
      rpc({ data: null, error: { code: '42501', message: 'analysis is not yours' } }),
    );
    expect(outcome.kind).toBe('refused');
  });
});
