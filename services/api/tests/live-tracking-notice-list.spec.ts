import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { LIVE_TRACKING_RPC, LiveTrackingNoticesSchema } from '@fieldforce/core';
import type { LiveTrackingNotices } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * `BE-W201` (`20261013000600_live_tracking_notice_list`) — the admin's read of the company's
 * live-tracking notice versions, which the console's `/tracking/notice` (`FE-W91`) draws.
 *
 * What is pinned: admin only, refused rather than emptied; "in force" is the SAME answer the phone
 * gets (`current_live_tracking_notice`: the latest approval, else the draft); `authoredByYou` is the
 * server's comparison, so the screen can tell the author to wait for a second admin; a version
 * replaced by a later approval is `superseded`; and another company's versions are never listed.
 * Every case runs in its own rolled-back transaction.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const TEXT = 'The company notice about location sharing during working hours. '.repeat(2);

const one = async <T>(client: Client, sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await client.query<{ r: T }>(sql, params);
  return (rows[0] as { r: T }).r;
};

const outcome = async (client: Client, sql: string) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql);
    await client.query('release savepoint probe');
    return { code: null as string | null, message: '' };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '' };
  }
};

const notices = async (client: Client): Promise<LiveTrackingNotices> =>
  LiveTrackingNoticesSchema.parse(
    await one(client, `select public.${LIVE_TRACKING_RPC.notices}() as r`),
  );

const propose = async (client: Client, label: string): Promise<string> =>
  one<string>(client, `select public.${LIVE_TRACKING_RPC.proposeNotice}($1, $2) as r`, [
    label,
    TEXT,
  ]);

const approve = async (client: Client, id: string): Promise<void> => {
  await client.query(`select public.${LIVE_TRACKING_RPC.approveNotice}($1, $2)`, [
    id,
    'read against the policy',
  ]);
};

const secondAdmin = async (client: Client): Promise<ProfileLike> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await asOwner(client, async () => {
      await client.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `ltn-admin-${id.slice(0, 8)}@example.test`],
      );
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'LTN second admin', 'admin', null, true, $2)`,
        [id, world.organisationId],
      );
    });
    return { id, role: 'admin', territoryId: null, isActive: true };
  });

describe.skipIf(!reachable)('BE-W201 — live_tracking_notices, the admin’s read', () => {
  it('refuses a rep and a field manager 42501, rather than answering an empty list', async () => {
    await inRolledBackTransaction(async (client) => {
      for (const user of [world.users.puneMr, world.users.westManager]) {
        await asUser(client, user);
        const refused = await outcome(client, `select public.${LIVE_TRACKING_RPC.notices}()`);
        expect(refused.code).toBe('42501');
        expect(refused.message).toMatch(/only an admin manages the live tracking notice/u);
      }
      // Positive control: the admin, same transaction.
      await asUser(client, world.users.admin);
      expect((await notices(client)).current).not.toBeNull();
    });
  });

  it('in force is the draft until a SECOND admin approves; the author is told it is theirs', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const before = await notices(client);
      const proposed = await propose(client, 'ltn-v1');

      const asAuthor = await notices(client);
      // Loading changes nothing a rep sees.
      expect(asAuthor.current).toEqual(before.current);
      expect(asAuthor.versions[0]).toMatchObject({
        id: proposed,
        versionLabel: 'ltn-v1',
        body: TEXT,
        status: 'waiting',
        authoredByYou: true,
        approvedAt: null,
        approverName: null,
      });

      const approver = await secondAdmin(client);
      await asUser(client, approver);
      expect((await notices(client)).versions[0]).toMatchObject({
        id: proposed,
        authoredByYou: false,
        status: 'waiting',
      });
      await approve(client, proposed);

      const after = await notices(client);
      expect(after.current).toMatchObject({ id: proposed, isDraft: false, body: TEXT });
      expect(after.current?.approvedAt).not.toBeNull();
      expect(after.versions[0]).toMatchObject({
        id: proposed,
        status: 'in_force',
        approverName: 'LTN second admin',
        attestation: 'read against the policy',
      });

      // The same answer the phone is given: one rule, two readers.
      await asUser(client, world.users.puneMr);
      const phone = await one<{ notice: { id: string } }>(
        client,
        `select public.${LIVE_TRACKING_RPC.myLiveTracking}() as r`,
      );
      expect(phone.notice.id).toBe(proposed);
    });
  });

  it('a version replaced by a later approval is superseded; newest first', async () => {
    await inRolledBackTransaction(async (client) => {
      const approver = await secondAdmin(client);
      await asUser(client, world.users.admin);
      const v1 = await propose(client, 'ltn-old');
      await asUser(client, approver);
      await approve(client, v1);

      // The approver of v1 writes v2; the author of v1 approves it — four eyes per version.
      const v2 = await propose(client, 'ltn-new');
      await asUser(client, world.users.admin);
      await approve(client, v2);

      const list = await notices(client);
      expect(list.current?.id).toBe(v2);
      const mine = list.versions.filter((v) => v.id === v1 || v.id === v2);
      expect(mine.map((v) => [v.versionLabel, v.status, v.authoredByYou])).toEqual([
        ['ltn-new', 'in_force', false],
        ['ltn-old', 'superseded', true],
      ]);
    });
  });

  it('never lists another company’s versions, nor the engineering draft as a company version', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const ours = await propose(client, 'ltn-ours');
      await asUser(client, world.users.rivalAdmin);
      const rival = await notices(client);
      expect(rival.versions.map((v) => v.id)).not.toContain(ours);
      expect(rival.current?.id).not.toBe(ours);
      const draftIds = await asOwner(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `select id from public.live_tracking_notice_versions where organisation_id is null`,
        );
        return rows.map((r) => r.id);
      });
      expect(rival.versions.some((v) => draftIds.includes(v.id))).toBe(false);
    });
  });

  it('is not granted to anon', async () => {
    const granted = await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', 'public.live_tracking_notices()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.live_tracking_notices()', 'execute') as authenticated`,
      );
      return rows[0];
    });
    expect(granted).toEqual({ anon: false, authenticated: true });
  });
});
