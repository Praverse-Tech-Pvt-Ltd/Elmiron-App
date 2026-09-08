import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-03 A2 — what `sync_push` actually enforces, and what it drops.
 *
 * The question that decides the conversion target: if every screen write is routed through
 * `sync_push`, does a refusal still reach the MR with its own remedy?
 *
 * `sync_push` returns **per-item verdicts** — `{id, status, rejectionCode, rejectionDetail,
 * warnings}` — which is the right shape. But `rejectionCode` is a
 * `public.sync_rejection_code` enum, mapped from the SQLSTATE by a `case` that knows
 * `42501`, `0A000`, `23503`, `23502`, `23514`, `23505`, `22023` and `22P02` **and no
 * `450xx` code at all**. Every project-defined refusal therefore lands on
 * `internal_error`.
 *
 * And `apply_sync_item` does not route every entity through its RPC. Read from the live
 * function body rather than the migration, because it is a `create or replace` chain:
 *
 *   visit            -> direct INSERT
 *   check_in         -> perform record_check_in(...)      <- full enforcement
 *   check_out        -> perform record_check_out(...)     <- full enforcement
 *   call_report      -> revise_call_report(...) or INSERT
 *   consent_record   -> direct INSERT                     <- capture_consent NOT called
 *   sample_and_input -> direct INSERT (the UCPMP trigger still fires: table trigger)
 *   recording        -> perform complete_upload(...)      <- full enforcement
 *
 * The consent line is the one that matters, and it is asserted below rather than argued.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface PushVerdict {
  id: string;
  status: string;
  rejectionCode: string | null;
  rejectionDetail: string | null;
}

const push = async (client: Client, items: unknown[]): Promise<PushVerdict[]> => {
  const result = await client.query<{ payload: { results: PushVerdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as payload',
    [randomUUID(), JSON.stringify(items)],
  );
  const payload = result.rows[0]?.payload;
  if (payload === undefined) throw new Error('sync_push returned nothing');
  return payload.results;
};

/** A language of its own, with a notice superseded an hour ago. */
const supersededNotice = async (
  client: Client,
): Promise<{ language: string; displayed: string }> => {
  const language = `zz-${randomUUID().slice(0, 8)}`;
  const displayed = randomUUID();
  await client.query(
    `insert into public.consent_text_versions
       (id, version_label, language, full_text, effective_from)
     values ($1, $2, $3, 'The notice that was on the screen.', now() - interval '4 hours')`,
    [displayed, `mr03-old-${randomUUID().slice(0, 8)}`, language],
  );
  await client.query(
    `insert into public.consent_text_versions
       (id, version_label, language, full_text, effective_from)
     values ($1, $2, $3, 'A newer notice.', now() - interval '1 hour')`,
    [randomUUID(), `mr03-new-${randomUUID().slice(0, 8)}`, language],
  );
  return { language, displayed };
};

describe.skipIf(!reachable)('sync_push returns per-item verdicts', () => {
  it('one verdict per item, each carrying an id and a status', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const results = await push(client, [
        { id: randomUUID(), entity: 'visit', entityId: randomUUID(), payload: {} },
        { id: randomUUID(), entity: 'visit', entityId: randomUUID(), payload: {} },
      ]);
      expect(results).toHaveLength(2);
      for (const verdict of results) {
        expect(typeof verdict.id).toBe('string');
        expect(typeof verdict.status).toBe('string');
      }
    });
  });

  it('a batch does NOT collapse: one item can fail beside one that succeeds', async () => {
    // The property that makes sync_push a plausible single path at all. Without it, one
    // bad item would take an MR's whole day's work with it.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const good = randomUUID();
      const results = await push(client, [
        {
          id: good,
          entity: 'visit',
          entityId: good,
          payload: { doctorId: world.doctors.pune },
        },
        { id: randomUUID(), entity: 'visit', entityId: 'not-a-uuid', payload: {} },
      ]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.status).sort()).toEqual(['accepted', 'rejected']);
    });
  });
});

describe.skipIf(!reachable)('what the verdict loses on the way out', () => {
  it('the rejectionCode enum has no 450xx member at all', async () => {
    // Structural, and it is the whole finding in one query. Five sessions of error-contract
    // work produced 45001, 45002, 45003, 45004, 45005, 45006, 45007 and 45008; the enum a
    // sync verdict can carry knows none of them.
    await inRolledBackTransaction(async (client) => {
      const labels = await client.query<{ enumlabel: string }>(
        `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'sync_rejection_code'`,
      );
      const values = labels.rows.map((r) => r.enumlabel);
      expect(values.length).toBeGreaterThan(5);
      expect(values).toContain('internal_error');
      // Nothing named for a consent notice change, a cap, a clock or a stale sync.
      expect(values).not.toContain('consent_notice_superseded');
      expect(values).not.toContain('ucpmp_sample_cap_exceeded');
    });
  });

  it('the SQLSTATE-to-code map covers no 450xx code', async () => {
    await inRolledBackTransaction(async (client) => {
      const src = await client.query<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'sync_push'`,
      );
      const body = src.rows[0]?.prosrc ?? '';
      // A positive control on the read: the map does exist and does cover 42501.
      expect(body).toMatch(/v_sqlstate = '42501'/);
      // And covers nothing this project minted.
      for (const code of ['45001', '45002', '45003', '45004', '45007', '45008']) {
        expect(body, `sync_push maps ${code}`).not.toContain(code);
      }
    });
  });
});

describe.skipIf(!reachable)('THE FINDING: consent through sync_push skips capture_consent', () => {
  it('capture_consent REFUSES a notice superseded before the capture', async () => {
    // The baseline. Without it, the acceptance below could mean the fixture was wrong
    // rather than that the path is unguarded.
    await inRolledBackTransaction(async (client) => {
      const { language, displayed } = await supersededNotice(client);
      await asUser(client, world.users.puneMr);
      await expect(
        client.query('select public.capture_consent($1, $2, $3, $4, $5)', [
          randomUUID(),
          world.visits.pune,
          'consented',
          language,
          displayed,
        ]),
      ).rejects.toMatchObject({ code: '45001' });
    });
  });

  it('sync_push ACCEPTS the identical capture, unvalidated', async () => {
    // `apply_sync_item` inserts straight into `consent_records`. So every bound FIX-12
    // built -- the version active AT captured_at (45001), no future capture (45007), the
    // maximum sync lag (45008) -- is absent on the offline path, which is the one path
    // where captured_at and received_at differ at all.
    await inRolledBackTransaction(async (client) => {
      const { language, displayed } = await supersededNotice(client);
      await asUser(client, world.users.puneMr);

      const id = randomUUID();
      const results = await push(client, [
        {
          id,
          entity: 'consent_record',
          entityId: id,
          payload: {
            visitId: world.visits.pune,
            doctorId: world.doctors.pune,
            outcome: 'consented',
            consentTextVersionId: displayed,
            displayedLanguage: language,
            capturedAt: new Date().toISOString(),
          },
        },
      ]);

      expect(results[0]?.status).toBe('accepted');

      // And the row is really there, with the superseded version recorded as displayed.
      await client.query('set local role postgres');
      const row = await client.query<{ consent_text_version_id: string }>(
        'select consent_text_version_id from public.consent_records where id = $1',
        [id],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.consent_text_version_id).toBe(displayed);
    });
  });

  it('a future-dated capture is accepted too, which 45007 exists to refuse', async () => {
    await inRolledBackTransaction(async (client) => {
      const { language, displayed } = await supersededNotice(client);
      await asUser(client, world.users.puneMr);
      const id = randomUUID();
      const results = await push(client, [
        {
          id,
          entity: 'consent_record',
          entityId: id,
          payload: {
            visitId: world.visits.pune,
            doctorId: world.doctors.pune,
            outcome: 'consented',
            consentTextVersionId: displayed,
            displayedLanguage: language,
            // A day in the future. capture_consent refuses this with 45007.
            capturedAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
      ]);
      expect(results[0]?.status).toBe('accepted');
    });
  });

  it('check_in, by contrast, DOES go through its RPC', async () => {
    // The contrast is what makes the consent finding a gap rather than a design. The same
    // function routes check_in through `record_check_in`, so geofence, shift window and
    // the server clock are all enforced on the offline path.
    await inRolledBackTransaction(async (client) => {
      const src = await client.query<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'apply_sync_item'`,
      );
      const body = src.rows[0]?.prosrc ?? '';
      expect(body).toMatch(/perform public\.record_check_in/);
      expect(body).toMatch(/perform public\.record_check_out/);
      expect(body).toMatch(/perform public\.complete_upload/);
      // And consent does not.
      expect(body).not.toMatch(/public\.capture_consent/);
    });
  });
});
