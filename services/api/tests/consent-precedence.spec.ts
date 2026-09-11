import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * MR-27 B1 — the ONE ordering definition, guarded against itself.
 *
 * MR-26 B1 had the client reproduce this schema's ordering. MR-27 removed that: the pull now
 * transmits `precedence` from `public.consent_text_version_precedence`, and
 * `active_consent_text_at` orders by the same view. One definition.
 *
 * **What is left to guard.** The two consumers can still be pulled apart by a future edit —
 * someone re-inlines an `order by` into `active_consent_text_at`, or changes the view's keys
 * without it. These cases assert the RPC and the view agree, and they do it with a TIE ON
 * EACH KEY IN TURN, because a single-key tie is precisely what made the original divergence
 * invisible: with distinct `effective_from` values a one-key sort and a three-key sort give
 * the same answer, and every test passes.
 *
 * The order is `effective_from desc, created_at desc, id desc`, so each case below leaves
 * exactly one key doing the work and holds the rest equal.
 */

const reachable = await requireDatabase();

type Client = Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0];

/** A tenant of its own, so an accumulated fixture organisation cannot lend a row. */
const tenant = async (client: Client): Promise<string> => {
  const orgId = randomUUID();
  await client.query(`insert into public.organisations (id, name) values ($1, $2)`, [
    orgId,
    `MR27 precedence ${orgId.slice(0, 8)}`,
  ]);
  return orgId;
};

const notice = async (
  client: Client,
  orgId: string,
  args: {
    readonly label: string;
    readonly effectiveFrom: string;
    readonly createdAt?: string;
    readonly id?: string;
    readonly language?: string;
  },
): Promise<string> => {
  const id = args.id ?? randomUUID();
  await client.query(
    `insert into public.consent_text_versions
       (id, organisation_id, version_label, language, full_text, effective_from, created_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz, coalesce($7::timestamptz, now()))`,
    [
      id,
      orgId,
      args.label,
      args.language ?? 'en-IN',
      `text for ${args.label}`,
      args.effectiveFrom,
      args.createdAt ?? null,
    ],
  );
  return id;
};

/** What the RPC picks, and what the view ranks first. They must be the same row. */
const both = async (
  client: Client,
  orgId: string,
): Promise<{ rpc: string | null; rankedFirst: string | null }> => {
  const rpc = await client.query<{ id: string | null }>(
    `select (public.active_consent_text_at('en-IN', now(), $1)).id as id`,
    [orgId],
  );
  const ranked = await client.query<{ id: string }>(
    `select v.id
       from public.consent_text_versions v
       join public.consent_text_version_precedence p on p.id = v.id
      where v.organisation_id = $1
        and v.language = 'en-IN'
        and v.effective_from <= now()
        and (v.effective_until is null or v.effective_until > now())
      order by p.precedence
      limit 1`,
    [orgId],
  );
  return { rpc: rpc.rows[0]?.id ?? null, rankedFirst: ranked.rows[0]?.id ?? null };
};

describe.skipIf(!reachable)('the RPC and the precedence view cannot disagree', () => {
  it('TIE ON effective_from — created_at decides, and both agree', async () => {
    await inRolledBackTransaction(async (client) => {
      const orgId = await tenant(client);
      const sameFrom = '2026-09-01T00:00:00Z';
      const earlier = await notice(client, orgId, {
        label: 'earlier',
        effectiveFrom: sameFrom,
        createdAt: '2026-09-01T09:00:00Z',
      });
      const later = await notice(client, orgId, {
        label: 'later',
        effectiveFrom: sameFrom,
        createdAt: '2026-09-01T10:00:00Z',
      });

      const { rpc, rankedFirst } = await both(client, orgId);
      // The precondition: both answered at all. Without it a query typo returns null from
      // each, they "agree", and the case passes having compared nothing — container, not
      // content.
      expect(rpc, 'the RPC returned no row; the query is wrong, not the data').not.toBeNull();
      expect(rpc).toBe(rankedFirst);
      expect(rpc, 'the later createdAt must win').toBe(later);
      expect(earlier).not.toBe(later);
    });
  });

  it('TIE ON effective_from AND created_at — id decides, and both agree', async () => {
    await inRolledBackTransaction(async (client) => {
      const orgId = await tenant(client);
      const sameFrom = '2026-09-01T00:00:00Z';
      const sameCreated = '2026-09-01T09:00:00Z';
      const lowId = await notice(client, orgId, {
        id: '11111111-1111-4111-8111-111111111111',
        label: 'low',
        effectiveFrom: sameFrom,
        createdAt: sameCreated,
      });
      const highId = await notice(client, orgId, {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        label: 'high',
        effectiveFrom: sameFrom,
        createdAt: sameCreated,
      });

      const { rpc, rankedFirst } = await both(client, orgId);
      expect(rpc).not.toBeNull();
      expect(rpc).toBe(rankedFirst);
      expect(rpc, 'the higher id must win, descending').toBe(highId);
      expect(lowId).not.toBe(highId);
    });
  });

  it('NO TIE — effective_from decides, and both agree', async () => {
    await inRolledBackTransaction(async (client) => {
      const orgId = await tenant(client);
      await notice(client, orgId, { label: 'older', effectiveFrom: '2026-08-01T00:00:00Z' });
      const newer = await notice(client, orgId, {
        label: 'newer',
        effectiveFrom: '2026-09-01T00:00:00Z',
      });

      const { rpc, rankedFirst } = await both(client, orgId);
      expect(rpc).not.toBeNull();
      expect(rpc).toBe(rankedFirst);
      expect(rpc).toBe(newer);
    });
  });

  it('ranks from 1 per language, so `precedence: 1` means what the client assumes', async () => {
    await inRolledBackTransaction(async (client) => {
      const orgId = await tenant(client);
      const newer = await notice(client, orgId, {
        label: 'newer',
        effectiveFrom: '2026-09-01T00:00:00Z',
      });
      await notice(client, orgId, { label: 'older', effectiveFrom: '2026-08-01T00:00:00Z' });

      const rows = await client.query<{ id: string; precedence: number }>(
        `select p.id, p.precedence
           from public.consent_text_version_precedence p
           join public.consent_text_versions v on v.id = p.id
          where v.organisation_id = $1 order by p.precedence`,
        [orgId],
      );
      expect(rows.rows.map((r) => r.precedence)).toEqual([1, 2]);
      expect(rows.rows[0]?.id).toBe(newer);
    });
  });

  it('ranks each LANGUAGE from 1 independently — the partition, asserted', async () => {
    await inRolledBackTransaction(async (client) => {
      const orgId = await tenant(client);
      await notice(client, orgId, { label: 'en', effectiveFrom: '2026-09-01T00:00:00Z' });
      await notice(client, orgId, {
        label: 'hi',
        language: 'hi-IN',
        effectiveFrom: '2026-08-01T00:00:00Z',
      });

      const rows = await client.query<{ language: string; precedence: number }>(
        `select v.language, p.precedence
           from public.consent_text_version_precedence p
           join public.consent_text_versions v on v.id = p.id
          where v.organisation_id = $1 order by v.language`,
        [orgId],
      );
      // Without the partition, hi-IN's only notice would rank 2 because its effective_from is
      // older — and the client, which takes the LOWEST precedence per language, would find
      // nothing ranked 1 for Hindi and offer no notice at all.
      expect(rows.rows).toEqual([
        { language: 'en-IN', precedence: 1 },
        { language: 'hi-IN', precedence: 1 },
      ]);
    });
  });
});
