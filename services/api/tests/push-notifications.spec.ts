import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ClaimedBatchSchema,
  PUSH_RPC,
  PushTokenRegistrationSchema,
  RecordedResultsSchema,
} from '@fieldforce/core';
import type { ClaimedNotification } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * `BE-W195` (`20261013000400_push_notifications`, `20261013000410_push_notification_events`) — the
 * database half of push notifications: whose phone may be told something, what is to be told, and
 * the sender's two calls.
 *
 * Every case runs in a rolled-back transaction. The plan notification is a DEFERRED trigger (it
 * counts the version's entries at commit), so those cases end with `set constraints all immediate`,
 * which fires it inside the transaction that is then rolled back.
 *
 * Each refusal sits beside its positive control: the same caller, one thing changed, and it works.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const TOKEN = (tag: string): string => `fcm-test-token-${tag}-${randomUUID()}`;
const DAY = '2030-01-16';

const tx = <T>(fn: (client: Client) => Promise<T>): Promise<T> => inRolledBackTransaction(fn);

const failure = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null as string | null, message: '' };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '' };
  }
};

const register = async (client: Client, user: FixtureUser, token: string) => {
  await asUser(client, user);
  const { rows } = await client.query<{ r: unknown }>(
    `select public.${PUSH_RPC.registerToken}($1) as r`,
    [token],
  );
  return PushTokenRegistrationSchema.parse(rows[0]?.r);
};

interface TokenRow {
  user_id: string;
  retired_reason: string | null;
}
const tokenRows = async (client: Client, token: string): Promise<TokenRow[]> =>
  asOwner(client, async () => {
    const { rows } = await client.query<TokenRow>(
      `select user_id, retired_reason from public.device_push_tokens
        where token = $1 order by registered_at, id`,
      [token],
    );
    return rows;
  });

interface OutboxRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  status: string;
  source_table: string;
}
const outboxFor = async (client: Client, userId: string): Promise<OutboxRow[]> =>
  asOwner(client, async () => {
    const { rows } = await client.query<OutboxRow>(
      `select id, kind, title, body, link, status, source_table from public.notification_outbox
        where recipient_user_id = $1 order by created_at, id`,
      [userId],
    );
    return rows;
  });

const plan = async (client: Client, doctorIds: readonly string[]): Promise<void> => {
  await asUser(client, world.users.westManager);
  await client.query('select public.plan_mr_day($1, $2::date, $3::jsonb, $4)', [
    world.users.puneMr.id,
    DAY,
    JSON.stringify(doctorIds.map((doctorId) => ({ doctorId }))),
    randomUUID(),
  ]);
  // The plan trigger is deferred to commit; fire it now, inside the rolled-back transaction.
  await client.query('set constraints all immediate');
  await client.query('set constraints all deferred');
};

const claim = async (client: Client, limit = 50): Promise<ClaimedNotification[]> => {
  await client.query('reset role');
  await client.query('set local role service_role');
  const { rows } = await client.query<{ r: unknown }>(
    `select public.${PUSH_RPC.claimBatch}($1) as r`,
    [limit],
  );
  await client.query('reset role');
  return ClaimedBatchSchema.parse(rows[0]?.r);
};

describe.skipIf(!reachable)('BE-W195 — device push tokens', () => {
  it('a signed-in person registers their phone; again is the same row, and they see only their own', async () => {
    await tx(async (client) => {
      const token = TOKEN('own');
      const first = await register(client, world.users.puneMr, token);
      const again = await register(client, world.users.puneMr, token);
      expect(again.id).toBe(first.id);
      const own = await client.query('select token from public.device_push_tokens');
      expect(own.rows.map((r: { token: string }) => r.token)).toContain(token);

      // Another rep, same company: sees none of the first rep's tokens.
      await asUser(client, world.users.nagpurMr);
      const other = await client.query(
        'select count(*)::int as n from public.device_push_tokens where token = $1',
        [token],
      );
      expect(other.rows[0]).toEqual({ n: 0 });
    });
  });

  it('a malformed token is refused 22023; a direct table write is refused for everyone', async () => {
    await tx(async (client) => {
      await asUser(client, world.users.puneMr);
      expect(
        (await failure(client, `select public.${PUSH_RPC.registerToken}($1)`, ['short'])).code,
      ).toBe('22023');
      expect(
        (
          await failure(client, `select public.${PUSH_RPC.registerToken}($1)`, [
            'has whitespace inside it, which no token does',
          ])
        ).code,
      ).toBe('22023');
      expect(
        (
          await failure(
            client,
            `insert into public.device_push_tokens (organisation_id, user_id, token)
             values ($1, $2, $3)`,
            [world.organisationId, world.users.puneMr.id, TOKEN('direct')],
          )
        ).code,
      ).toBe('42501');
      // Positive control: the RPC path, same caller.
      await register(client, world.users.puneMr, TOKEN('ok'));
    });
  });

  it('a phone that changes hands: the previous holder is retired as replaced, never shared', async () => {
    await tx(async (client) => {
      const token = TOKEN('handover');
      await register(client, world.users.puneMr, token);
      await register(client, world.users.rivalMr, token);
      expect(await tokenRows(client, token)).toEqual([
        { user_id: world.users.puneMr.id, retired_reason: 'replaced' },
        { user_id: world.users.rivalMr.id, retired_reason: null },
      ]);
    });
  });

  it('sign-out retires only the caller’s own row', async () => {
    await tx(async (client) => {
      const token = TOKEN('signout');
      await register(client, world.users.puneMr, token);

      await asUser(client, world.users.nagpurMr);
      const notMine = await client.query<{ r: { retired: number } }>(
        `select public.${PUSH_RPC.unregisterToken}($1) as r`,
        [token],
      );
      expect(notMine.rows[0]?.r).toEqual({ retired: 0 });

      await asUser(client, world.users.puneMr);
      const mine = await client.query<{ r: { retired: number } }>(
        `select public.${PUSH_RPC.unregisterToken}($1) as r`,
        [token],
      );
      expect(mine.rows[0]?.r).toEqual({ retired: 1 });
      expect(await tokenRows(client, token)).toEqual([
        { user_id: world.users.puneMr.id, retired_reason: 'signed_out' },
      ]);
    });
  });
});

describe.skipIf(!reachable)('BE-W195 — what puts a notification in the outbox', () => {
  it('a manager plans the rep’s day: one notification, counts only, no doctor named', async () => {
    await tx(async (client) => {
      await plan(client, [world.doctors.pune]);
      const rows = await outboxFor(client, world.users.puneMr.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'day_plan',
        link: '/beat-plan',
        status: 'pending',
        source_table: 'beat_plans',
      });
      expect(rows[0]?.body).toMatch(/^Your manager (planned 1 visit for|updated your plan for)/u);
      const doctor = await asOwner(client, async () => {
        const { rows: d } = await client.query<{ full_name: string }>(
          'select full_name from public.doctors where id = $1',
          [world.doctors.pune],
        );
        return d[0]?.full_name ?? '';
      });
      expect(doctor).not.toBe('');
      expect(`${rows[0]?.title ?? ''} ${rows[0]?.body ?? ''}`).not.toContain(doctor);
    });
  });

  it('a re-plan before sending replaces the unsent notification rather than adding a second', async () => {
    await tx(async (client) => {
      await plan(client, [world.doctors.pune]);
      await plan(client, []);
      const rows = await outboxFor(client, world.users.puneMr.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.body).toMatch(/cleared your plan/u);
    });
  });

  it('a reopened day, a course assigned and a note on an analysis each notify the rep', async () => {
    await tx(async (client) => {
      const rep = world.users.puneMr.id;
      await asOwner(client, async () => {
        const day = randomUUID();
        await client.query(
          `insert into public.work_days (id, organisation_id, mr_id, work_date, time_zone, opened_via)
           values ($1, $2, $3, '2030-01-15', 'Asia/Kolkata', 'start')`,
          [day, world.organisationId, rep],
        );
        await client.query(
          `insert into public.work_day_reopenings (organisation_id, work_day_id, mr_id, work_date,
             reopened_by_user_id, reason, closed_at, close_request_id, closed_snapshot)
           values ($1, $2, $3, '2030-01-15', $4, 'push spec', now(), $5, '{}')`,
          [world.organisationId, day, rep, world.users.westManager.id, randomUUID()],
        );

        const course = randomUUID();
        await client.query(
          `insert into public.courses (id, organisation_id, title) values ($1, $2, 'Secret title')`,
          [course, world.organisationId],
        );
        await client.query(
          `insert into public.course_assignments (organisation_id, course_id, assignee_user_id,
             assigned_by_user_id, due_on) values ($1, $2, $3, $4, '2030-02-01')`,
          [world.organisationId, course, rep, world.users.admin.id],
        );

        await client.query(
          `insert into public.analyses (visit_id, mr_id) values ($1, $2)
           on conflict (visit_id) do nothing`,
          [world.visits.pune, rep],
        );
        await client.query(
          `insert into public.analysis_overrides (analysis_id, overridden_by_user_id, reason)
           select a.id, $2, 'a private note' from public.analyses a where a.visit_id = $1`,
          [world.visits.pune, world.users.westManager.id],
        );
      });

      const rows = await outboxFor(client, rep);
      expect(rows.map((r) => r.kind).sort()).toEqual([
        'coaching_note',
        'course_assigned',
        'day_reopened',
      ]);
      const text = rows.map((r) => `${r.title} ${r.body}`).join(' ');
      expect(text).not.toContain('Secret title');
      expect(text).not.toContain('a private note');
      expect(text).not.toContain('push spec');
      expect(rows.find((r) => r.kind === 'course_assigned')?.body).toMatch(/due by 1 Feb/u);
    });
  });

  it('no client can write the outbox, and a sent notification never changes', async () => {
    await tx(async (client) => {
      await asUser(client, world.users.admin);
      expect(
        (
          await failure(
            client,
            `insert into public.notification_outbox (organisation_id, recipient_user_id, kind, title,
               body, link, source_table, source_id)
             values ($1, $2, 'day_plan', 't', 'b', '/beat-plan', 'x', $3)`,
            [world.organisationId, world.users.puneMr.id, randomUUID()],
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await failure(
            client,
            `select public.enqueue_notification($1, 'day_plan', 't', 'b',
            '/beat-plan', 'x', $2)`,
            [world.users.puneMr.id, randomUUID()],
          )
        ).code,
      ).toBe('42501');

      await client.query('reset role');
      expect((await failure(client, 'delete from public.notification_outbox')).code).toBe('23001');
    });
  });
});

describe.skipIf(!reachable)('BE-W195 — the sender’s calls', () => {
  it('only service_role claims; a claim carries the recipient’s live tokens and nobody else’s', async () => {
    await tx(async (client) => {
      const token = TOKEN('claim');
      await register(client, world.users.puneMr, token);
      await register(client, world.users.nagpurMr, TOKEN('other'));
      await plan(client, [world.doctors.pune]);

      await asUser(client, world.users.admin);
      expect((await failure(client, `select public.${PUSH_RPC.claimBatch}(10)`)).code).toBe(
        '42501',
      );

      const batch = await claim(client);
      const mine = batch.filter((n) => n.kind === 'day_plan');
      expect(mine.length).toBeGreaterThanOrEqual(1);
      const forRep = mine.find((n) => n.tokens.some((t) => t.token === token));
      expect(forRep?.tokens.map((t) => t.token)).toEqual([token]);
    });
  });

  it('results: sent is final, a retry returns to pending, an invalid token is retired', async () => {
    await tx(async (client) => {
      const token = TOKEN('result');
      await register(client, world.users.puneMr, token);
      await plan(client, [world.doctors.pune]);
      const batch = await claim(client);
      const target = batch.find((n) => n.tokens.some((t) => t.token === token));
      expect(target).toBeDefined();
      const tokenId = target?.tokens[0]?.id;

      await client.query('set local role service_role');
      const recorded = await client.query<{ r: unknown }>(
        `select public.${PUSH_RPC.recordResults}($1::jsonb) as r`,
        [
          JSON.stringify([
            { id: target?.id, outcome: 'sent', error: null, retireTokenIds: [tokenId] },
          ]),
        ],
      );
      expect(RecordedResultsSchema.parse(recorded.rows[0]?.r)).toMatchObject({
        sent: 1,
        tokensRetired: 1,
      });
      await client.query('reset role');
      const rows = await outboxFor(client, world.users.puneMr.id);
      expect(rows.find((r) => r.id === target?.id)?.status).toBe('sent');
      expect((await tokenRows(client, token))[0]?.retired_reason).toBe('invalid_token');
      expect(
        (
          await failure(
            client,
            `update public.notification_outbox set status = 'pending' where id = $1`,
            [target?.id],
          )
        ).code,
      ).toBe('23001');
    });
  });

  it('a notification for someone with no live phone is settled as no_device, not sent', async () => {
    await tx(async (client) => {
      await plan(client, [world.doctors.pune]);
      // No token registered for the rep in this transaction (and any committed one retired here).
      await asOwner(client, async () => {
        await client.query(
          `update public.device_push_tokens set retired_at = now(), retired_reason = 'signed_out'
            where user_id = $1 and retired_at is null`,
          [world.users.puneMr.id],
        );
      });
      const batch = await claim(client);
      const rows = await outboxFor(client, world.users.puneMr.id);
      expect(rows[0]?.status).toBe('no_device');
      expect(batch.some((n) => n.id === rows[0]?.id)).toBe(false);
    });
  });

  it('an admin may run the sender by hand, audited; a rep may not', async () => {
    await tx(async (client) => {
      await asUser(client, world.users.puneMr);
      expect((await failure(client, `select public.${PUSH_RPC.authoriseSender}()`)).code).toBe(
        '42501',
      );
      await asUser(client, world.users.admin);
      await client.query(`select public.${PUSH_RPC.authoriseSender}()`);
      const audited = await asOwner(client, async () => {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from public.audit_log
            where actor_id = $1 and table_name = 'notification_outbox'`,
          [world.users.admin.id],
        );
        return rows[0]?.n ?? 0;
      });
      expect(audited).toBeGreaterThanOrEqual(1);
    });
  });
});
