import { describe, expect, it } from 'vitest';
import { CreateCallReportRequestSchema, RepCallReportStatusSchema } from './endpoints.js';

/**
 * `FE-W196` — a report the rep sends is `submitted`. Without a status the server stored every
 * phone's report as `'draft'` (`apply_sync_item`'s default), and the managers' approval queue lists
 * only `submitted`, so no report sent from a phone ever reached a manager.
 */
const report = {
  id: '77777777-7777-4777-8777-777777777711',
  visitId: '66666666-6666-4666-8666-666666666601',
  summary: 'Discussed the dosing guide.',
  productIdsDiscussed: [],
};

describe('CreateCallReportRequestSchema — status', () => {
  it('carries `submitted` through the parse, so the server is told', () => {
    expect(CreateCallReportRequestSchema.parse({ ...report, status: 'submitted' }).status).toBe(
      'submitted',
    );
  });

  it('still parses a report queued by an older build, with no status', () => {
    expect(CreateCallReportRequestSchema.parse(report).status).toBeUndefined();
  });

  it('refuses every status that is not the rep’s to give', () => {
    for (const status of ['draft', 'approved', 'rejected', '']) {
      expect(CreateCallReportRequestSchema.safeParse({ ...report, status }).success).toBe(false);
    }
  });

  it('offers the rep exactly one status', () => {
    expect(RepCallReportStatusSchema.options).toEqual(['submitted']);
  });
});
