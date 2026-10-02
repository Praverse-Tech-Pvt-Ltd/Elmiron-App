import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { API_URL, SERVICE_ROLE_KEY, asOwner, asUser, mintAccessToken, rest } from './auth.js';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import { consentBody } from './sync-bodies.js';

/**
 * W1-N Part B -- `BE-W129`. A rejected write is counted, by SQLSTATE, by company, over a period.
 *
 * **The question (B1):** *"for my company, between two dates, how many writes were rejected, of which
 * kind, through which path?"* -- `count_write_rejections`. Every test here ends by ASKING THAT
 * QUESTION, not by peeking at the table: a log nobody can query is the defect, not the fix.
 *
 * **Both paths (B3).** Sync is driven through `sync_push` -- in a rolled-back transaction, because it
 * catches each item in a subtransaction and the log row is visible beside it. The direct path is
 * driven over REAL HTTP with committed state, because the mechanism that lets a refusal commit its
 * log row only engages for a PostgREST request.
 *
 * **Two-sided throughout (B5):** every rejection has a positive control proving an ACCEPTED write
 * produces no row -- otherwise a function that logged everything would pass.
 */

const reachable = await requireDatabase();
let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const hoursFromNow = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();

interface Counted {
  sqlstate: string;
  entryPoint: string;
  rejections: number;
  items: number;
}

/** B1's question, asked as the company admin. */
const askAdmin = async (client: Client, from: string, to: string): Promise<Counted[]> => {
  await asUser(client, world.users.admin);
  const { rows } = await client.query<{ r: Counted[] }>(
    'select public.count_write_rejections($1, $2) as r',
    [from, to],
  );
  return rows[0]?.r ?? [];
};

const pushAs = async (client: Client, user: FixtureUser, items: unknown[]) => {
  await asUser(client, user);
  const { rows } = await client.query<{
    p: { results: { status: string; sqlState: string | null }[] };
  }>('select public.sync_push($1, $2::jsonb) as p', [randomUUID(), JSON.stringify(items)]);
  return rows[0]?.p.results ?? [];
};

const consent = (capturedAt: string) => {
  const id = randomUUID();
  return {
    id,
    entity: 'consent_record',
    entityId: id,
    payload: consentBody({
      id,
      visitId: world.visits.pune,
      doctorId: world.doctors.pune,
      outcome: 'consented',
      consentTextVersionId: world.consentTextVersionId,
      displayedLanguage: 'en-IN',
      capturedAt,
    }),
  };
};

describe.skipIf(!reachable)('W1-N B — the SYNC path: every rejection is a countable row', () => {
  it('45007 (clock ahead) and 45008 (too late) are counted by code; the accepted capture is not', async () => {
    await inRolledBackTransaction(async (client) => {
      const from = hoursFromNow(-1);
      const results = await pushAs(client, world.users.puneMr, [
        consent(hoursFromNow(1)), // beyond the 120-second tolerance
        consent(hoursFromNow(-80)), // beyond the 72-hour lag
        consent(new Date().toISOString()), // POSITIVE CONTROL
      ]);
      expect(results.map((r) => [r.status, r.sqlState])).toEqual([
        ['rejected', '45007'],
        ['rejected', '45008'],
        ['accepted', null],
      ]);
      expect(await askAdmin(client, from, hoursFromNow(1))).toEqual([
        { sqlstate: '45007', entryPoint: 'sync_push', rejections: 1, items: 1 },
        { sqlstate: '45008', entryPoint: 'sync_push', rejections: 1, items: 1 },
      ]);
    });
  });

  it('POSITIVE CONTROL: a batch of accepted writes leaves the count empty', async () => {
    await inRolledBackTransaction(async (client) => {
      const from = hoursFromNow(-1);
      const results = await pushAs(client, world.users.puneMr, [consent(new Date().toISOString())]);
      expect(results[0]?.status).toBe('accepted');
      expect(await askAdmin(client, from, hoursFromNow(1))).toEqual([]);
    });
  });

  it('the reason is the CODE; the prose sits beside it and says the number', async () => {
    await inRolledBackTransaction(async (client) => {
      await pushAs(client, world.users.puneMr, [consent(hoursFromNow(-80))]);
      const row = await asOwner(client, () =>
        client.query<{ sqlstate: string; detail: string }>(
          `select sqlstate, detail from public.write_rejections where user_id = $1`,
          [world.users.puneMr.id],
        ),
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.sqlstate).toBe('45008');
      expect(row.rows[0]?.detail).toMatch(/maximum is 72 hours/u);
    });
  });

  it('W1-V C (BE-W138): a counted rejection cannot be edited, deleted or truncated — not even by the owner', async () => {
    // Proved as the OWNER, as every peer's append-only test is: the owner bypasses grants and RLS,
    // so only the trigger stands between it and the record.
    const refused = async (client: Client, sql: string, params: unknown[] = []) => {
      await client.query('savepoint probe');
      try {
        await client.query(sql, params);
        await client.query('release savepoint probe');
        return null;
      } catch (error) {
        await client.query('rollback to savepoint probe');
        return (error as { code?: string }).code ?? 'unknown';
      }
    };
    await inRolledBackTransaction(async (client) => {
      await pushAs(client, world.users.puneMr, [consent(hoursFromNow(-80))]);
      await asOwner(client, async () => {
        const mine = [world.users.puneMr.id];
        expect(
          await refused(
            client,
            `update public.write_rejections set sqlstate = '00000' where user_id = $1`,
            mine,
          ),
        ).toBe('23001');
        expect(
          await refused(client, `delete from public.write_rejections where user_id = $1`, mine),
        ).toBe('23001');
        expect(await refused(client, 'truncate public.write_rejections')).toBe('23001');
        // POSITIVE CONTROL: the row is still there, unchanged — and inserting still works.
        const row = await client.query<{ sqlstate: string }>(
          'select sqlstate from public.write_rejections where user_id = $1',
          mine,
        );
        expect(row.rows.map((r) => r.sqlstate)).toEqual(['45008']);
      });
    });
  });

  it('the count is the company’s own, and only an admin may ask', async () => {
    await inRolledBackTransaction(async (client) => {
      const from = hoursFromNow(-1);
      await pushAs(client, world.users.puneMr, [consent(hoursFromNow(1))]);
      // Another company's admin asks the same question and sees none of it.
      await asUser(client, world.users.rivalAdmin);
      const rival = await client.query<{ r: Counted[] }>(
        'select public.count_write_rejections($1, $2) as r',
        [from, hoursFromNow(1)],
      );
      expect(rival.rows[0]?.r).toEqual([]);
      // The MR cannot ask at all, and neither can their manager.
      for (const who of [world.users.puneMr, world.users.westManager]) {
        await asUser(client, who);
        await client.query('savepoint s');
        await expect(
          client.query('select public.count_write_rejections($1, $2)', [from, hoursFromNow(1)]),
        ).rejects.toMatchObject({ code: '42501' });
        await client.query('rollback to savepoint s');
      }
      // POSITIVE CONTROL: our admin sees the one rejection.
      expect(await askAdmin(client, from, hoursFromNow(1))).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// The DIRECT path -- over HTTP, committed, because that is where the mechanism engages.
// ---------------------------------------------------------------------------

const SYNTHETIC_AUDIO = new Uint8Array(32);

/** A committed visit with a consent, and a stored-bytes upload grant for it. */
const committedGrant = async (): Promise<{ grantId: string }> =>
  withClient(async (db) => {
    const visitId = randomUUID();
    await db.query('begin');
    try {
      await asOwner(db, async () => {
        await db.query(
          `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
          [visitId, world.users.puneMr.id, world.doctors.pune],
        );
        await db.query(
          `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, captured_at)
           values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
          [
            randomUUID(),
            visitId,
            world.doctors.pune,
            world.users.puneMr.id,
            world.consentTextVersionId,
          ],
        );
      });
      await asUser(db, world.users.puneMr);
      const grant = await db.query<{ id: string; storage_key: string }>(
        'select * from public.begin_upload($1, $2, $3, $4)',
        [visitId, 'recording', SYNTHETIC_AUDIO.length, 240],
      );
      await db.query('commit');
      const row = grant.rows[0];
      if (row === undefined) throw new Error('begin_upload returned nothing');
      const stored = await fetch(`${API_URL}/storage/v1/object/audio/${row.storage_key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'audio/mp4' },
        body: SYNTHETIC_AUDIO,
      });
      if (!stored.ok) throw new Error(`storage upload failed: ${String(stored.status)}`);
      return { grantId: row.id };
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  });

const finaliseOverHttp = (grantId: string, objectId: string, recordedAt: string) =>
  rest('/rpc/complete_upload', {
    method: 'POST',
    token: mintAccessToken(world.users.puneMr),
    body: {
      p_grant_id: grantId,
      p_object_id: objectId,
      p_duration_seconds: 60,
      p_size_bytes: SYNTHETIC_AUDIO.length,
      p_recorded_at: recordedAt,
      p_bitrate_kbps: 128,
    },
  });

/** Rows for one object, read as the owner -- committed state, so any connection sees it. */
const rowsFor = (entityId: string) =>
  withClient(async (db) => {
    const { rows } = await db.query<{ entry_point: string; sqlstate: string }>(
      `select entry_point, sqlstate from public.write_rejections
        where entity_id = $1 or sync_item_id = $1 order by occurred_at`,
      [entityId],
    );
    return rows.map((r) => `${r.entry_point}:${r.sqlstate}`);
  });

describe.skipIf(!reachable)('W1-N B — the DIRECT path, over HTTP', () => {
  it('a direct 45010 is refused EXACTLY as before — same status, same code — and is now counted', async () => {
    const { grantId } = await committedGrant();
    const objectId = randomUUID();
    const response = await finaliseOverHttp(grantId, objectId, hoursFromNow(-80));
    // What the client sees is unchanged: 400 with PostgREST's error envelope and the SQLSTATE.
    expect(response.status, response.text).toBe(400);
    expect(response.body).toMatchObject({ code: '45010' });
    expect((response.body as { message: string }).message).toMatch(/older than the server/u);
    // ...and the refusal now survives as a row.
    expect(await rowsFor(objectId)).toEqual(['complete_upload:45010']);
  });

  it('POSITIVE CONTROL: an accepted direct upload writes no rejection', async () => {
    const { grantId } = await committedGrant();
    const objectId = randomUUID();
    const response = await finaliseOverHttp(grantId, objectId, hoursFromNow(-0.01));
    expect(response.status, response.text).toBe(200);
    expect(await rowsFor(objectId)).toEqual([]);
  });

  it('the SAME refusal arriving through sync over HTTP is ONE row, and the item is still REJECTED', async () => {
    // The guard this pins: inside an HTTP `sync_push`, `request.method` is set, so without it the
    // wrapper would RETURN its envelope instead of raising -- `apply_sync_item` would read that as
    // success, mark the item accepted, and set the whole batch's HTTP status to 400.
    const { grantId } = await committedGrant();
    const itemId = randomUUID();
    const response = await rest('/rpc/sync_push', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_batch_id: randomUUID(),
        p_items: [
          {
            id: itemId,
            entity: 'recording',
            operation: 'create',
            entityId: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
            payload: {
              uploadGrantId: grantId,
              durationSeconds: 60,
              sizeBytes: SYNTHETIC_AUDIO.length,
              bitrateKbps: 128,
              recordedAt: hoursFromNow(-80),
            },
          },
        ],
      },
    });
    expect(response.status, response.text).toBe(200);
    const results = (response.body as { results: { status: string; sqlState: string }[] }).results;
    expect(results[0]).toMatchObject({ status: 'rejected', sqlState: '45010' });
    expect(await rowsFor(itemId)).toEqual(['sync_push:45010']);
  });
});
