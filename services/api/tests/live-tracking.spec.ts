import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { LIVE_TRACKING_RPC, LiveTrackingStatusSchema, PingVerdictSchema } from '@fieldforce/core';
import type { LiveTrackingStatus, PingVerdict } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser, inDdlTransaction, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * `BE-W180` / `BE-W181` (`20261013000100_live_tracking`) — live tracking, decided by the database.
 *
 * Every case runs in its own rolled-back transaction, and widens the fixture company's working hours
 * to the whole day first unless the hours are what it tests, so what is tested is the rule and not
 * the hour the suite happens to run at. The company switch is set through the real admin RPC.
 *
 * Each refusal has its positive control beside it: the same rep, the same transaction, one condition
 * changed, and the position IS kept — so a refusal cannot pass because nothing is ever kept.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const LAT = 18.5204;
const LON = 73.8567;

/** The whole day, every day, for the fixture company -- inside the caller's transaction. */
const allDayShift = async (client: Client): Promise<void> => {
  await asOwner(client, async () => {
    await client.query(
      `update public.territory_shift_windows w
          set shift_start = '00:00', shift_end = '23:59', grace_minutes = 60,
              active_weekdays = '{1,2,3,4,5,6,7}'
         from public.territories t
        where t.id = w.territory_id and t.organisation_id = $1`,
      [world.organisationId],
    );
  });
};

/** Every weekday EXCEPT today's (in each window's own zone): now is outside working hours. */
const notToday = async (client: Client): Promise<void> => {
  await asOwner(client, async () => {
    await client.query(
      `update public.territory_shift_windows w
          set shift_start = '00:00', shift_end = '23:59', grace_minutes = 0,
              active_weekdays = array(
                select d::smallint from generate_series(1, 7) d
                 where d <> extract(isodow from now() at time zone w.timezone))
         from public.territories t
        where t.id = w.territory_id and t.organisation_id = $1`,
      [world.organisationId],
    );
  });
};

const one = async <T>(client: Client, sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await client.query<{ r: T }>(sql, params);
  return (rows[0] as { r: T }).r;
};

const outcome = async (client: Client, sql: string, params: unknown[] = []) => {
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

const status = async (client: Client): Promise<LiveTrackingStatus> =>
  LiveTrackingStatusSchema.parse(
    await one(client, `select public.${LIVE_TRACKING_RPC.myLiveTracking}() as r`),
  );

const PING = `select public.${LIVE_TRACKING_RPC.recordPing}($1, $2, $3, $4, now() + make_interval(secs => $5)) as r`;

/** A position from the rep now in session, taken `offsetSeconds` from the server's now. */
const ping = async (
  client: Client,
  options: { id?: string; offsetSeconds?: number; accuracy?: number | null } = {},
): Promise<PingVerdict & { id: string }> => {
  const id = options.id ?? randomUUID();
  const verdict = PingVerdictSchema.parse(
    await one(client, PING, [
      id,
      LAT,
      LON,
      options.accuracy === undefined ? 15 : options.accuracy,
      options.offsetSeconds ?? 0,
    ]),
  );
  return { ...verdict, id };
};

const switchOn = async (client: Client, on = true): Promise<void> => {
  await asUser(client, world.users.admin);
  await client.query(`select public.${LIVE_TRACKING_RPC.setEnabled}($1, $2)`, [
    on,
    'live-tracking.spec fixture switch -- not a product decision',
  ]);
};

const acceptCurrent = async (client: Client): Promise<LiveTrackingStatus> => {
  const before = await status(client);
  return LiveTrackingStatusSchema.parse(
    await one(client, `select public.${LIVE_TRACKING_RPC.acceptNotice}($1) as r`, [
      before.notice?.id,
    ]),
  );
};

/** Switched on, whole-day hours, the Pune rep in session having accepted the current notice. */
const readyRep = async (client: Client): Promise<void> => {
  await allDayShift(client);
  await switchOn(client);
  await asUser(client, world.users.puneMr);
  await acceptCurrent(client);
};

const rejection = async (client: Client, pingId: string) =>
  asOwner(client, async () => {
    const { rows } = await client.query<{ sqlstate: string; detail: string; entry_point: string }>(
      `select sqlstate, detail, entry_point from public.write_rejections where entity_id = $1`,
      [pingId],
    );
    return rows;
  });

const stored = async (client: Client, pingId: string): Promise<number> =>
  asOwner(client, async () => {
    const { rowCount } = await client.query('select 1 from public.location_pings where id = $1', [
      pingId,
    ]);
    return rowCount ?? 0;
  });

/** A second admin of the fixture company, for four-eyes. Made under the identity lock. */
const secondAdmin = async (client: Client): Promise<ProfileLike> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await asOwner(client, async () => {
      await client.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `lt-admin-${id.slice(0, 8)}@example.test`],
      );
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'LT second admin', 'admin', null, true, $2)`,
        [id, world.organisationId],
      );
    });
    return { id, role: 'admin', territoryId: null, isActive: true };
  });

describe.skipIf(!reachable)('BE-W180 — rule 1: off unless the company switched it on', () => {
  it('a company that never chose is OFF, and a position is refused and counted', async () => {
    await inRolledBackTransaction(async (client) => {
      await allDayShift(client);
      await asUser(client, world.users.puneMr);
      expect((await status(client)).companyEnabled).toBe(false);
      const p = await ping(client);
      expect(p).toMatchObject({ stored: false, reason: 'company_off' });
      expect(await stored(client, p.id)).toBe(0);
      expect(await rejection(client, p.id)).toEqual([
        { sqlstate: '42501', detail: 'company_off', entry_point: 'record_location_ping' },
      ]);
    });
  });

  it('POSITIVE CONTROL: switched on, accepted, in hours -- the position is kept, server-stamped', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const p = await ping(client, { offsetSeconds: -30 });
      expect(p).toMatchObject({ stored: true, replayed: false, reason: null });
      const row = await asOwner(client, async () => {
        const { rows } = await client.query<{ late: boolean; ninety: boolean; device: boolean }>(
          `select received_at >= now() as late,
                  purge_after = received_at + interval '90 days' as ninety,
                  recorded_at = now() - interval '30 seconds' as device
             from public.location_pings where id = $1`,
          [p.id],
        );
        return rows[0];
      });
      expect(row).toEqual({ late: true, ninety: true, device: true });
    });
  });

  it('switched on and then off again, the next position is refused', async () => {
    await inRolledBackTransaction(async (client) => {
      await allDayShift(client);
      // Two rows at two instants: one transaction's `now()` is one instant, and two rows for one
      // key at the same `effective_from` would be ambiguous (and refused by the unique key).
      await asOwner(client, async () => {
        await client.query(
          `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
           values ('live_tracking_enabled', 'true',  'organisation', $1, 'live-tracking.spec on',  now() - interval '2 minutes'),
                  ('live_tracking_enabled', 'false', 'organisation', $1, 'live-tracking.spec off', now() - interval '1 minute')`,
          [world.organisationId],
        );
      });
      await asUser(client, world.users.puneMr);
      await acceptCurrent(client);
      expect((await status(client)).companyEnabled).toBe(false);
      expect((await ping(client)).reason).toBe('company_off');
    });
  });

  it('an admin switches it, with a reason, and the change is audited', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const noReason = await outcome(
        client,
        `select public.${LIVE_TRACKING_RPC.setEnabled}(true, ' ')`,
      );
      expect(noReason.code).toBe('22023');
      expect(noReason.message).toContain('live_tracking_switch_needs_reason');

      await client.query(`select public.${LIVE_TRACKING_RPC.setEnabled}(true, 'pilot')`);
      const audited = await asOwner(client, async () => {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from public.audit_log a
             join public.app_thresholds t on t.id::text = a.row_id
            where a.table_name = 'app_thresholds' and a.actor_id = $1
              and t.key = 'live_tracking_enabled' and t.organisation_id = $2`,
          [world.users.admin.id, world.organisationId],
        );
        return rows[0]?.n;
      });
      expect(audited).toBe(1);
    });
  });

  it.each<{ label: string; who: 'westManager' | 'puneMr' }>([
    { label: 'a field manager', who: 'westManager' },
    { label: 'a rep', who: 'puneMr' },
  ])('$label cannot switch it', async ({ who }) => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users[who]);
      const result = await outcome(
        client,
        `select public.${LIVE_TRACKING_RPC.setEnabled}(true, 'mine')`,
      );
      expect(result.code).toBe('42501');
    });
  });

  it('the interval is the company setting, held between 60 and 3600 seconds', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      expect((await status(client)).intervalSeconds).toBe(300);
      for (const [value, expected, ago] of [
        [5, 60, '2 minutes'],
        [99_999, 3600, '1 minute'],
      ] as const) {
        await asOwner(client, async () => {
          await client.query(
            `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
             values ('live_tracking_interval_seconds', to_jsonb($2::int), 'organisation', $1,
                     'live-tracking.spec bounds', now() - $3::interval)`,
            [world.organisationId, value, ago],
          );
        });
        expect((await status(client)).intervalSeconds).toBe(expected);
      }
    });
  });
});

describe.skipIf(!reachable)('BE-W180 — rule 2: the rep accepted the CURRENT notice', () => {
  it('no acceptance, no position; accepted, kept', async () => {
    await inRolledBackTransaction(async (client) => {
      await allDayShift(client);
      await switchOn(client);
      await asUser(client, world.users.puneMr);
      const before = await status(client);
      expect(before.accepted).toBe(false);
      expect(before.notice?.isDraft).toBe(true);
      expect(before.notice?.body).toContain('DRAFT - NOT APPROVED');
      expect((await ping(client)).reason).toBe('no_acceptance');
      expect((await acceptCurrent(client)).accepted).toBe(true);
      expect((await ping(client)).stored).toBe(true);
    });
  });

  it('accepting twice is one acceptance', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await acceptCurrent(client);
      await acceptCurrent(client);
      const n = await asOwner(client, async () => {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from public.live_tracking_acceptances where mr_id = $1`,
          [world.users.puneMr.id],
        );
        return rows[0]?.n;
      });
      expect(n).toBe(1);
    });
  });

  it('a withdrawal stops the next position at once', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const withdrawn = LiveTrackingStatusSchema.parse(
        await one(client, `select public.${LIVE_TRACKING_RPC.withdraw}() as r`),
      );
      expect(withdrawn.accepted).toBe(false);
      expect((await ping(client)).reason).toBe('no_acceptance');
    });
  });

  it('withdrawing with nothing accepted writes nothing -- no row is invented', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.nagpurMr);
      await client.query(`select public.${LIVE_TRACKING_RPC.withdraw}()`);
      const n = await asOwner(client, async () => {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from public.live_tracking_acceptances where mr_id = $1`,
          [world.users.nagpurMr.id],
        );
        return rows[0]?.n;
      });
      expect(n).toBe(0);
    });
  });

  it('a newly APPROVED company notice needs accepting again; the old one is refused 45001', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const draftId = (await status(client)).notice?.id;

      await asUser(client, world.users.admin);
      const proposed = await one<string>(
        client,
        `select public.${LIVE_TRACKING_RPC.proposeNotice}($1, $2) as r`,
        ['v1', 'The company notice about location sharing during working hours. '.repeat(2)],
      );

      // Proposed but not approved: the reps still see the draft, and their acceptance still holds.
      await asUser(client, world.users.puneMr);
      expect((await status(client)).accepted).toBe(true);

      const approver = await secondAdmin(client);
      await asUser(client, approver);
      await client.query(`select public.${LIVE_TRACKING_RPC.approveNotice}($1, $2)`, [
        proposed,
        'read and approved',
      ]);

      await asUser(client, world.users.puneMr);
      const after = await status(client);
      expect(after.notice).toMatchObject({ id: proposed, isDraft: false });
      expect(after.accepted).toBe(false);
      expect(after.acceptedNoticeVersionId).toBe(draftId);
      expect((await ping(client)).reason).toBe('no_acceptance');

      const stale = await outcome(client, `select public.${LIVE_TRACKING_RPC.acceptNotice}($1)`, [
        draftId,
      ]);
      expect(stale.code).toBe('45001');
      expect((await acceptCurrent(client)).accepted).toBe(true);
      expect((await ping(client)).stored).toBe(true);
    });
  });

  it('four eyes: the author cannot approve, the draft cannot be approved, another company cannot', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const proposed = await one<string>(
        client,
        `select public.${LIVE_TRACKING_RPC.proposeNotice}($1, $2) as r`,
        ['v-author', 'The company notice about location sharing during working hours. '.repeat(2)],
      );
      const draftId = await asOwner(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `select id from public.live_tracking_notice_versions where organisation_id is null limit 1`,
        );
        return rows[0]?.id;
      });

      const approve = `select public.${LIVE_TRACKING_RPC.approveNotice}($1, 'approved')`;
      expect((await outcome(client, approve, [proposed])).code).toBe('42501');
      expect((await outcome(client, approve, [draftId])).code).toBe('42501');
      await asUser(client, world.users.rivalAdmin);
      expect((await outcome(client, approve, [proposed])).code).toBe('42501');

      // And the trigger holds it whoever inserts: the owner, with the author as approver.
      const direct = await asOwner(client, async () =>
        outcome(
          client,
          `insert into public.live_tracking_notice_approvals (notice_version_id, approved_by_user_id, attestation)
           values ($1, $2, 'direct')`,
          [proposed, world.users.admin.id],
        ),
      );
      expect(direct.code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W180 — rule 3: inside working hours, by the server', () => {
  it('outside the window the position is refused 45003 and counted', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      await notToday(client);
      expect((await status(client)).withinWorkingHours).toBe(false);
      const p = await ping(client);
      expect(p.reason).toBe('outside_working_hours');
      expect((await rejection(client, p.id)).map((r) => r.sqlstate)).toEqual(['45003']);
    });
  });

  it('no window configured anywhere is outside, not an error', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      await asOwner(client, async () => {
        await client.query(
          `delete from public.territory_shift_windows w using public.territories t
            where t.id = w.territory_id and t.organisation_id = $1`,
          [world.organisationId],
        );
      });
      expect((await ping(client)).reason).toBe('outside_working_hours');
    });
  });

  it.each([
    ['at the server time', 0, null],
    ['120 s ahead -- the tolerance, inclusive', 120, null],
    ['121 s ahead', 121, 'recorded_in_future'],
    ['600 s old', -600, null],
    ['601 s old -- not live any more', -601, 'too_old'],
  ])('a device clock %s', async (_label, offset, expected) => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      expect((await ping(client, { offsetSeconds: offset })).reason).toBe(expected);
    });
  });

  it('accuracy worse than 5 km is not kept; no accuracy at all is', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      expect((await ping(client, { accuracy: 5001 })).reason).toBe('implausible_accuracy');
      expect((await ping(client, { accuracy: null })).stored).toBe(true);
    });
  });

  it('faster than half the interval is refused; the same id again is the same position', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const first = await ping(client);
      expect(first.stored).toBe(true);
      expect(await ping(client, { id: first.id })).toMatchObject({ stored: true, replayed: true });
      expect((await ping(client)).reason).toBe('too_frequent');
      expect(await stored(client, first.id)).toBe(1);
    });
  });

  it('another rep cannot reuse a position id', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const first = await ping(client);
      await asUser(client, world.users.nagpurMr);
      await acceptCurrent(client);
      const reuse = await outcome(client, PING, [first.id, LAT, LON, 10, 0]);
      expect(reuse.code).toBe('22023');
    });
  });

  it('a malformed position is a malformed request (22023), not a verdict', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      expect((await outcome(client, PING, [randomUUID(), 91, LON, 10, 0])).code).toBe('22023');
      expect((await outcome(client, PING, [randomUUID(), LAT, LON, -1, 0])).code).toBe('22023');
    });
  });

  it.each<{ label: string; who: 'westManager' | 'admin' }>([
    { label: 'a field manager', who: 'westManager' },
    { label: 'an admin', who: 'admin' },
  ])('$label does not send positions (42501)', async ({ who }) => {
    await inRolledBackTransaction(async (client) => {
      await allDayShift(client);
      await switchOn(client);
      await asUser(client, world.users[who]);
      expect((await outcome(client, PING, [randomUUID(), LAT, LON, 10, 0])).code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W180 — rule 4: who sees a position', () => {
  /** One kept position of the Pune rep's, then `fn` as somebody else, same transaction. */
  const withPunePing = async (fn: (client: Client, pingId: string) => Promise<void>) =>
    inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const p = await ping(client);
      expect(p.stored).toBe(true);
      await fn(client, p.id);
    });

  const rowsSeen = async (client: Client): Promise<number> => {
    const { rowCount } = await client.query(
      `select 1 from public.location_pings where mr_id = $1`,
      [world.users.puneMr.id],
    );
    return rowCount ?? 0;
  };

  it.each<{ label: string; who: keyof FixtureWorld['users']; expected: number }>([
    { label: 'the rep themself', who: 'puneMr', expected: 1 },
    { label: 'their manager (subtree and reporting line)', who: 'westManager', expected: 1 },
    { label: 'their company admin', who: 'admin', expected: 1 },
    { label: 'a manager of a sibling subtree', who: 'southManager', expected: 0 },
    { label: 'another rep in the same company', who: 'nagpurMr', expected: 0 },
    { label: 'an admin of ANOTHER company', who: 'rivalAdmin', expected: 0 },
    { label: 'a rep of another company', who: 'rivalMr', expected: 0 },
  ])('$label reads $expected row(s) directly', async ({ who, expected }) => {
    await withPunePing(async (client) => {
      await asUser(client, world.users[who]);
      expect(await rowsSeen(client)).toBe(expected);
    });
  });

  it('anon reads nothing: no grant at all', async () => {
    await withPunePing(async (client) => {
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await client.query('set local role anon');
      const result = await outcome(client, 'select 1 from public.location_pings');
      expect(result.code).toBe('42501');
    });
  });

  it('nobody writes the table directly, not even the rep', async () => {
    await withPunePing(async (client) => {
      await asUser(client, world.users.puneMr);
      const result = await outcome(
        client,
        `insert into public.location_pings (id, organisation_id, mr_id, notice_version_id, latitude,
           longitude, recorded_at, received_at, purge_after)
         select $1, organisation_id, mr_id, notice_version_id, 0, 0, now(), now(), now()
           from public.location_pings limit 1`,
        [randomUUID()],
      );
      expect(result.code).toBe('42501');
    });
  });

  it('the overview lists exactly the reps the caller may see, with the latest position', async () => {
    await withPunePing(async (client) => {
      await asUser(client, world.users.westManager);
      const west = await one<{ reps: { mrId: string; latest: unknown }[] }>(
        client,
        `select public.${LIVE_TRACKING_RPC.overview}() as r`,
      );
      expect(west.reps.map((r) => r.mrId).sort()).toEqual(
        [world.users.puneMr.id, world.users.nagpurMr.id].sort(),
      );
      expect(west.reps.find((r) => r.mrId === world.users.puneMr.id)?.latest).not.toBeNull();

      await asUser(client, world.users.southManager);
      const south = await one<{ reps: { mrId: string }[] }>(
        client,
        `select public.${LIVE_TRACKING_RPC.overview}() as r`,
      );
      expect(south.reps.map((r) => r.mrId)).toEqual([world.users.southMr.id]);

      await asUser(client, world.users.rivalAdmin);
      const rival = await one<{ reps: { mrId: string }[] }>(
        client,
        `select public.${LIVE_TRACKING_RPC.overview}() as r`,
      );
      expect(rival.reps.map((r) => r.mrId)).toEqual([world.users.rivalMr.id]);

      await asUser(client, world.users.puneMr);
      const rep = await outcome(client, `select public.${LIVE_TRACKING_RPC.overview}()`);
      expect(rep.code).toBe('42501');
    });
  });

  it('the trail: own, manager and admin read it; anybody else is refused with one answer', async () => {
    await withPunePing(async (client, pingId) => {
      const trail = `select public.${LIVE_TRACKING_RPC.trail}($1) as r`;
      for (const who of ['puneMr', 'westManager', 'admin'] as const) {
        await asUser(client, world.users[who]);
        const got = await one<{ points: { id: string }[] }>(client, trail, [world.users.puneMr.id]);
        expect(got.points.map((p) => p.id)).toEqual([pingId]);
      }
      for (const who of ['nagpurMr', 'southManager', 'rivalAdmin'] as const) {
        await asUser(client, world.users[who]);
        expect((await outcome(client, trail, [world.users.puneMr.id])).code).toBe('42501');
      }
      // An id that is nobody is the same refusal, so the refusal reveals nothing.
      await asUser(client, world.users.westManager);
      expect((await outcome(client, trail, [randomUUID()])).code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W180 / BE-W181 — append-only, and rule 5: 90 days', () => {
  it('no role updates a position, or deletes one before its time', async () => {
    await inRolledBackTransaction(async (client) => {
      await readyRep(client);
      const p = await ping(client);
      await asOwner(client, async () => {
        const update = await outcome(
          client,
          'update public.location_pings set latitude = 0 where id = $1',
          [p.id],
        );
        expect(update.code).toBe('23001');
        const remove = await outcome(client, 'delete from public.location_pings where id = $1', [
          p.id,
        ]);
        expect(remove.code).toBe('23001');
        const ledger = await outcome(client, 'delete from public.live_tracking_acceptances');
        expect(ledger.code).toBe('23001');
      });
      expect(await stored(client, p.id)).toBe(1);
    });
  });

  it('the purge deletes an expired position and leaves a live one', async () => {
    // DDL (disabling the stamping trigger so the fixture can be born expired), hence the lock.
    await inDdlTransaction(async (client) => {
      await readyRep(client);
      const live = await ping(client);
      const expired = randomUUID();
      await asOwner(client, async () => {
        await client.query(
          'alter table public.location_pings disable trigger location_pings_stamp',
        );
        await client.query(
          `insert into public.location_pings (id, organisation_id, mr_id, territory_id, notice_version_id,
             latitude, longitude, accuracy_m, recorded_at, received_at, purge_after)
           select $1, organisation_id, mr_id, territory_id, notice_version_id, latitude, longitude,
                  accuracy_m, now() - interval '91 days', now() - interval '91 days', now() - interval '1 day'
             from public.location_pings where id = $2`,
          [expired, live.id],
        );
        await client.query('alter table public.location_pings enable trigger location_pings_stamp');
        const { rows } = await client.query<{ n: number }>(
          'select public.purge_expired_location_pings(10000) as n',
        );
        expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
      });
      expect(await stored(client, expired)).toBe(0);
      expect(await stored(client, live.id)).toBe(1);
    });
  });

  it('the purge is not callable by a client', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const result = await outcome(client, 'select public.purge_expired_location_pings(1)');
      expect(result.code).toBe('42501');
    });
  });

  it('the hourly retention worker is what calls it (a purge nothing runs is not a purge)', async () => {
    const worker = await readFile(
      new URL('../scripts/purge-expired-audio.mjs', import.meta.url),
      'utf8',
    );
    expect(worker).toContain('public.purge_expired_location_pings(');
    const workflow = await readFile(
      new URL('../../../.github/workflows/retention.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('purge:audio');
  });

  it('RLS is enabled AND forced on every live-tracking table', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ relname: string; on: boolean; forced: boolean }>(
        `select relname, relrowsecurity as on, relforcerowsecurity as forced from pg_class
          where relnamespace = 'public'::regnamespace
            and relname in ('location_pings', 'live_tracking_acceptances',
                            'live_tracking_notice_versions', 'live_tracking_notice_approvals')
          order by relname`,
      );
      expect(rows).toHaveLength(4);
      for (const row of rows) expect(row).toMatchObject({ on: true, forced: true });
    });
  });
});
