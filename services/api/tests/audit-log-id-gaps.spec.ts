import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * MR-43 B — `audit_log.id` is monotonic and NOT contiguous, and the reason lives on the column.
 *
 * MR-42's write probes rolled back with zero rows committed and still moved `audit_log_id_seq`
 * 29337 → 29356. Sequences are non-transactional by design: `nextval()` cannot hand a number
 * back while a concurrent transaction may be using it.
 *
 * **A gap in an append-only ledger's ids looks exactly like a deleted row**, and the person who
 * meets one will be looking at the table rather than at this repository. So the explanation is a
 * column comment — and this suite is what stops that comment being dropped silently by a later
 * migration, since nothing else would notice.
 *
 * The assertions are on the CONTENT of the comment, not on its presence. A comment that exists
 * and says nothing useful is the failure mode a `is not null` check would wave through.
 */

const reachable = await requireDatabase();

const COLUMN_COMMENT = `select col_description(
     'public.audit_log'::regclass,
     (select attnum from pg_attribute
       where attrelid = 'public.audit_log'::regclass and attname = 'id')
   ) as comment`;

describe.skipIf(!reachable)('MR-43 B1 — the gap explanation is attached to the column', () => {
  it('says the ids are not contiguous, and that a gap is not a deletion', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ comment: string | null }>(COLUMN_COMMENT);
      const comment = rows[0]?.comment ?? '';

      expect(comment).toMatch(/NOT contiguous/u);
      // The sentence that does the real work for a reader who has just found a gap.
      expect(comment).toMatch(/GAP IS NOT A DELETED ROW/u);
      // And the reason, so it is not mistaken for a defect to be fixed.
      expect(comment).toMatch(/non-transactional/u);
    });
  });

  it('points at what DOES guarantee the ledger, not just at what does not', async () => {
    // A warning with no replacement leaves the reader without an integrity check at all.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ comment: string | null }>(COLUMN_COMMENT);
      expect(rows[0]?.comment ?? '').toMatch(/trigger/u);
    });
  });
});

describe.skipIf(!reachable)('MR-43 B2 — the property itself, not just the documentation', () => {
  it('advances the sequence even when the transaction is rolled back', async () => {
    // The behaviour the comment describes, demonstrated rather than asserted from the manual.
    // Without this the comment could describe a property this database does not have.
    const before = await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ last: string }>(
        `select last_value as last from public.audit_log_id_seq`,
      );
      return rows[0]?.last ?? '0';
    });

    await inRolledBackTransaction(async (client) => {
      await client.query(`select nextval('public.audit_log_id_seq')`);
      // and the transaction is rolled back by the helper
    });

    const after = await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ last: string }>(
        `select last_value as last from public.audit_log_id_seq`,
      );
      return rows[0]?.last ?? '0';
    });

    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('and no row was committed by that rollback — the positive control', async () => {
    // Establishes that the advance above is a GAP and not a row. Without it, the test would
    // also pass if the insert had succeeded, which is the opposite of the claim.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*) as n from public.audit_log where reason = 'MR-43 B2 must not exist'`,
      );
      expect(rows[0]?.n).toBe('0');
    });
  });
});
