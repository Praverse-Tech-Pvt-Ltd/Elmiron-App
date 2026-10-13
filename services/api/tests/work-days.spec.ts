import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { WorkDayRequestSchema, fromWorkDayRow } from '@fieldforce/core';
import type { WorkDayRequest } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import { workingDay } from './working-day.js';

/**
 * `BE-W190` / `BE-W191` — the rep's working day, on the server (`20261013000310_work_days`).
 *
 * Driven through `sync_push`, the path the phone uses (offline included), wherever the phone is the
 * caller; through the RPCs where a manager or an admin is. Every refusal is asserted by its SQLSTATE
 * and each has a POSITIVE CONTROL beside it -- the same act, unbroken, succeeding -- so no "refused"
 * here can be passing for an unrelated reason.
 *
 * **The day is TWO days back** (`workingDay(...).at(hh, -1)`): inside the seven days a phone may end
 * late, wholly in the past whatever time this runs, and never the day the fixture's own visit
 * (`now() - 1 hour`) falls on -- so the snapshot counts only what each test writes.
 */

const reachable = await requireDatabase();
let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 120_000);

const ZONE = 'Asia/Kolkata';

interface Verdict {
  status: string;
  sqlState: string | null;
  rejectionDetail: string | null;
}

interface Day {
  date: string;
  at: (hhmm: string) => Promise<string>;
}

/** Two days back, in the rep's zone. */
const theDay = async (client: Client): Promise<Day> => {
  const wd = await workingDay(client, ZONE);
  const date = (await client.query<{ d: string }>(`select ($1::date - 1)::text as d`, [wd.date]))
    .rows[0]?.d;
  if (date === undefined) throw new Error('no date');
  return { date, at: (hhmm) => wd.at(hhmm, -1) };
};

/** One `work_day` item through `sync_push`, as `who`. Body parsed by the contract. */
const push = async (
  client: Client,
  who: FixtureUser,
  body: WorkDayRequest,
  itemId: string = randomUUID(),
): Promise<Verdict> => {
  const payload = WorkDayRequestSchema.parse(body);
  await asUser(client, who);
  const { rows } = await client.query<{ result: { results: Verdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as result',
    [
      randomUUID(),
      JSON.stringify([
        { id: itemId, entity: 'work_day', operation: 'create', entityId: body.id, payload },
      ]),
    ],
  );
  await client.query('reset role');
  const verdict = rows[0]?.result.results[0];
  if (verdict === undefined) throw new Error('sync_push returned no verdict');
  return verdict;
};

const outcome = async (
  client: Client,
  sql: string,
  params: unknown[],
): Promise<{ code: string | null; message: string; rows: Record<string, unknown>[] }> => {
  await client.query('savepoint probe');
  try {
    const result = await client.query<Record<string, unknown>>(sql, params);
    await client.query('release savepoint probe');
    return { code: null, message: '', rows: result.rows };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '', rows: [] };
  }
};

/** As the owner: a visit of the Pune rep's on the day, and its check-in. Returns the visit id. */
const workedVisit = async (
  client: Client,
  day: Day,
  status: 'in_progress' | 'completed',
): Promise<string> => {
  const visitId = randomUUID();
  const started = await day.at('10:00');
  const ended = await day.at('10:40');
  await asOwner(client, async () => {
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, started_at,
                                  completed_at, origin, unplanned_reason)
       values ($1, $2, $3, $4, $5, $6, $7, 'unplanned', 'work day test')`,
      [
        visitId,
        world.users.puneMr.id,
        world.doctors.pune,
        world.clinicAddresses.pune,
        status,
        started,
        status === 'completed' ? ended : null,
      ],
    );
    await client.query(
      `insert into public.check_ins (id, visit_id, mr_id, latitude, longitude, geofence_status,
                                     source, occurred_at)
       values ($1, $2, $3, 18.5204, 73.8567, 'inside', 'manual', $4)`,
      [randomUUID(), visitId, world.users.puneMr.id, started],
    );
  });
  return visitId;
};

/** A check-in on the day, as the owner -- the strongest caller: if it is refused, every path is. */
const checkInOnTheDay = (client: Client, day: Day, visitId: string, hhmm: string) =>
  day.at(hhmm).then((at) =>
    outcome(
      client,
      `insert into public.check_ins (id, visit_id, mr_id, latitude, longitude, geofence_status,
                                     source, occurred_at)
       values ($1, $2, $3, 18.5204, 73.8567, 'inside', 'manual', $4)`,
      [randomUUID(), visitId, world.users.puneMr.id, at],
    ),
  );

const close = async (day: Day, over: Partial<WorkDayRequest> = {}): Promise<WorkDayRequest> => ({
  id: randomUUID(),
  action: 'close',
  workDate: day.date,
  occurredAt: await day.at('18:30'),
  note: null,
  ...over,
});

const dayRow = async (client: Client, date: string) =>
  (
    await client.query<Record<string, unknown>>(
      'select * from public.work_days where mr_id = $1 and work_date = $2',
      [world.users.puneMr.id, date],
    )
  ).rows[0];

describe.skipIf(!reachable)('BE-W190 — a check-in opens the day', () => {
  it('the fixture’s committed check-in opened the rep’s day, stamped by the server', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{
        opened_via: string;
        client_opened_at: Date;
        occurred_at: Date;
        closed_at: Date | null;
      }>(
        `select w.opened_via, w.client_opened_at, c.occurred_at, w.closed_at
           from public.work_days w
           join public.check_ins c on c.id = $2
          where w.mr_id = $1`,
        [world.users.puneMr.id, world.checkIns.pune],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.opened_via).toBe('check_in');
      // The phone's instant is kept BESIDE the server's stamp, never instead of it.
      expect(rows[0]?.client_opened_at.toISOString()).toBe(rows[0]?.occurred_at.toISOString());
      expect(rows[0]?.closed_at).toBeNull();
    });
  });

  it('the pull carries it to the rep, and to nobody outside the rep’s scope', async () => {
    await inRolledBackTransaction(async (client) => {
      const pull = async (who: FixtureUser): Promise<{ entity: string; payload: unknown }[]> => {
        await asUser(client, who);
        const { rows } = await client.query<{
          r: {
            changes: { entity: string; payload: unknown }[];
            completeness: { entities: string[] };
          };
        }>(`select public.sync_pull(null, array['work_day'], 500) as r`);
        await client.query('reset role');
        expect(rows[0]?.r.completeness.entities).toContain('work_day');
        return rows[0]?.r.changes ?? [];
      };
      const mine = await pull(world.users.puneMr);
      expect(mine).toHaveLength(1);
      // Parsed by the contract mapper the phone uses: a real payload, not a fixture.
      expect(fromWorkDayRow(mine[0]?.payload).mrId).toBe(world.users.puneMr.id);
      // The south rep has their own day and never the Pune rep's.
      const theirs = await pull(world.users.southMr);
      expect(
        theirs.map((c) => fromWorkDayRow(c.payload).mrId).includes(world.users.puneMr.id),
      ).toBe(false);
      // Another company's admin sees nothing of this one.
      expect(await pull(world.users.rivalAdmin)).toHaveLength(0);
    });
  });
});

describe.skipIf(!reachable)('BE-W190 — the rep ends the day, through sync_push', () => {
  it('REFUSED while a visit is still checked in (45016); nothing is closed', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await workedVisit(client, day, 'in_progress');
      const verdict = await push(client, world.users.puneMr, await close(day));
      expect(verdict.status).toBe('rejected');
      expect(verdict.sqlState).toBe('45016');
      expect((await dayRow(client, day.date))?.['closed_at']).toBeNull();
    });
  });

  it('ACCEPTED once checked out: the server’s stamp, the phone’s instant beside it, the snapshot', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await workedVisit(client, day, 'completed');
      await asOwner(client, async () => {
        await client.query(
          `insert into public.samples_and_inputs
             (id, visit_id, mr_id, doctor_id, kind, item_name, quantity, declared_value_inr, occurred_at)
           select $1, v.id, v.mr_id, v.doctor_id, 'sample', 'Elmiron 100mg', 3, 0, v.started_at
             from public.visits v
            where v.mr_id = $2 and v.status = 'completed' and v.unplanned_reason = 'work day test'`,
          [randomUUID(), world.users.puneMr.id],
        );
      });
      const body = await close(day, { note: '  Car broke down  ' });
      const verdict = await push(client, world.users.puneMr, body);
      expect(verdict.status).toBe('accepted');

      const row = await dayRow(client, day.date);
      expect(row?.['close_request_id']).toBe(body.id);
      expect((row?.['client_closed_at'] as Date).toISOString()).toBe(
        new Date(body.occurredAt).toISOString(),
      );
      // Server clock: the moment of the push, not the phone's 18:30 two days ago.
      const closedAt = (row?.['closed_at'] as Date).getTime();
      expect(Math.abs(closedAt - Date.now())).toBeLessThan(10 * 60_000);
      expect(row?.['closing_note']).toBe('Car broke down');
      expect(row).toMatchObject({
        visits_total: 1,
        visits_completed: 1,
        visits_not_met: 0,
        visits_missed: 0,
        visits_unplanned: 1,
        check_in_count: 1,
        samples_quantity: 3,
        inputs_quantity: 0,
      });
      // And the row as the pull sends it (`to_jsonb`) parses through the phone's own mapper.
      const json = await client.query<{ j: unknown }>(
        'select to_jsonb(w) as j from public.work_days w where w.id = $1',
        [row?.['id']],
      );
      expect(fromWorkDayRow(json.rows[0]?.j).totals?.visitsTotal).toBe(1);
    });
  });

  it('is IDEMPOTENT: a replay is a duplicate, and a second close returns the first, unchanged', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await workedVisit(client, day, 'completed');
      const body = await close(day);
      const itemId = randomUUID();
      expect((await push(client, world.users.puneMr, body, itemId)).status).toBe('accepted');
      expect((await push(client, world.users.puneMr, body, itemId)).status).toBe('duplicate');
      const first = await dayRow(client, day.date);

      const again = await push(client, world.users.puneMr, await close(day, { note: 'again' }));
      expect(again.status).toBe('accepted');
      const after = await dayRow(client, day.date);
      expect(after?.['close_request_id']).toBe(body.id);
      expect(after?.['closing_note']).toBe(first?.['closing_note']);
      expect((after?.['closed_at'] as Date).getTime()).toBe(
        (first?.['closed_at'] as Date).getTime(),
      );
    });
  });

  it('refuses a day outside the window a phone may end (22023), and a clock ahead of the server (45013)', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      const later = (await client.query<{ d: string }>(`select (current_date + 3)::text as d`))
        .rows[0]?.d;
      if (later === undefined) throw new Error('no date');
      const future = await push(client, world.users.puneMr, await close(day, { workDate: later }));
      expect(future.sqlState).toBe('22023');
      const ahead = await push(
        client,
        world.users.puneMr,
        await close(day, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
      );
      expect(ahead.sqlState).toBe('45013');
      // POSITIVE CONTROL: the same day, a sane clock, accepted.
      expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');
    });
  });

  it('a manager cannot end a rep’s day, or their own: only a rep ends a day (42501)', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await asUser(client, world.users.westManager);
      const r = await outcome(
        client,
        `select public.close_work_day($1, $2::date, $3::timestamptz, null)`,
        [randomUUID(), day.date, await day.at('18:30')],
      );
      expect(r.code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W190 — an ended day refuses new check-ins', () => {
  it('a check-in on an ENDED day is refused 45015 — even the owner’s', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      const visitId = await workedVisit(client, day, 'completed');
      // POSITIVE CONTROL: before the end, the same check-in is accepted.
      expect((await checkInOnTheDay(client, day, visitId, '11:00')).code).toBeNull();
      expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');
      const refused = await checkInOnTheDay(client, day, visitId, '11:30');
      expect(refused.code).toBe('45015');
      expect(refused.message).toMatch(/^work_day_closed/u);
    });
  });

  it('a "start my day" on an ended day is refused too: starting again IS reopening', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await workedVisit(client, day, 'completed');
      expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');
      const start = await push(client, world.users.puneMr, await close(day, { action: 'open' }));
      expect(start.sqlState).toBe('45015');
    });
  });

  it('"start my day" opens a day nothing had opened, and twice is once', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      const first = await close(day, { action: 'open' });
      expect((await push(client, world.users.puneMr, first)).status).toBe('accepted');
      expect(
        (await push(client, world.users.puneMr, await close(day, { action: 'open' }))).status,
      ).toBe('accepted');
      const row = await dayRow(client, day.date);
      expect(row).toMatchObject({
        opened_via: 'start',
        open_request_id: first.id,
        closed_at: null,
      });
    });
  });
});

describe.skipIf(!reachable)(
  'BE-W190 — only the rep’s manager or an admin reopens, with a reason',
  () => {
    const reopen = async (client: Client, who: FixtureUser, id: unknown, reason: string) => {
      await asUser(client, who);
      const r = await outcome(client, 'select * from public.reopen_work_day($1, $2)', [id, reason]);
      await client.query('reset role');
      return r;
    };

    it('refuses the rep, a manager outside the team, another company’s admin; needs a reason', async () => {
      await inRolledBackTransaction(async (client) => {
        const day = await theDay(client);
        await workedVisit(client, day, 'completed');
        expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');
        const id = (await dayRow(client, day.date))?.['id'];

        expect((await reopen(client, world.users.puneMr, id, 'my own day')).code).toBe('42501');
        expect((await reopen(client, world.users.southManager, id, 'not my team')).code).toBe(
          '42501',
        );
        expect((await reopen(client, world.users.rivalAdmin, id, 'other company')).code).toBe(
          '42501',
        );
        expect((await reopen(client, world.users.westManager, id, ' ')).code).toBe('22023');
        // POSITIVE CONTROL: the rep's own manager, with a reason.
        const ok = await reopen(client, world.users.westManager, id, 'Visit was missed off');
        expect(ok.code).toBeNull();
        expect(ok.rows[0]).toMatchObject({ closed_at: null, reopen_count: 1 });
      });
    });

    it('keeps the undone close whole, accepts check-ins again, and a replay of it does not re-close', async () => {
      await inRolledBackTransaction(async (client) => {
        const day = await theDay(client);
        const visitId = await workedVisit(client, day, 'completed');
        const body = await close(day, { note: 'first end' });
        const itemId = randomUUID();
        expect((await push(client, world.users.puneMr, body, itemId)).status).toBe('accepted');
        const id = (await dayRow(client, day.date))?.['id'];
        expect(
          (await reopen(client, world.users.admin, id, 'Admin reopened for a late visit')).code,
        ).toBeNull();

        const kept = await client.query<{
          reason: string;
          close_request_id: string;
          reopened_by_user_id: string;
          closed_snapshot: Record<string, unknown>;
        }>('select * from public.work_day_reopenings where work_day_id = $1', [id]);
        expect(kept.rows).toHaveLength(1);
        expect(kept.rows[0]).toMatchObject({
          reason: 'Admin reopened for a late visit',
          close_request_id: body.id,
          reopened_by_user_id: world.users.admin.id,
        });
        expect(kept.rows[0]?.closed_snapshot).toMatchObject({
          closingNote: 'first end',
          visitsTotal: 1,
        });

        expect((await checkInOnTheDay(client, day, visitId, '17:00')).code).toBeNull();

        // The undone close, sent again by an RPC call (a sync replay is already a `duplicate`).
        await asUser(client, world.users.puneMr);
        const replay = await outcome(
          client,
          'select (public.close_work_day($1, $2::date, $3::timestamptz, null)).closed_at',
          [body.id, day.date, body.occurredAt],
        );
        await client.query('reset role');
        expect(replay.code).toBeNull();
        expect(replay.rows[0]?.['closed_at']).toBeNull();
      });
    });

    it('the reopening record is append-only, for every role', async () => {
      await inRolledBackTransaction(async (client) => {
        const day = await theDay(client);
        await workedVisit(client, day, 'completed');
        expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');
        const id = (await dayRow(client, day.date))?.['id'];
        expect(
          (await reopen(client, world.users.westManager, id, 'Visit was missed off')).code,
        ).toBeNull();
        const edit = await outcome(
          client,
          `update public.work_day_reopenings set reason = 'rewritten' where work_day_id = $1`,
          [id],
        );
        expect(edit.code).toBe('23001');
        const gone = await outcome(client, 'delete from public.work_days where id = $1', [id]);
        expect(gone.code).toBe('23001');
      });
    });
  },
);

describe.skipIf(!reachable)('BE-W190 — nobody writes the table directly', () => {
  it('a rep can neither insert nor update a day; every write is a function', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await asUser(client, world.users.puneMr);
      const insert = await outcome(
        client,
        `insert into public.work_days (organisation_id, mr_id, work_date, time_zone, opened_via)
         values ($1, $2, $3, 'UTC', 'start')`,
        [world.organisationId, world.users.puneMr.id, day.date],
      );
      expect(insert.code).toBe('42501');
      const update = await outcome(client, `update public.work_days set reopen_count = 9`, []);
      expect(update.code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W191 — the manager sees the team’s days', () => {
  it('lists every rep in view, with or without a day, and refuses a rep', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await theDay(client);
      await workedVisit(client, day, 'completed');
      expect((await push(client, world.users.puneMr, await close(day))).status).toBe('accepted');

      await asUser(client, world.users.westManager);
      const team = await outcome(client, 'select * from public.team_work_days($1::date)', [
        day.date,
      ]);
      await client.query('reset role');
      expect(team.code).toBeNull();
      const byRep = new Map(team.rows.map((r) => [r['mr_id'], r]));
      expect(byRep.get(world.users.puneMr.id)).toMatchObject({ status: 'closed', visits_total: 1 });
      // A rep with no day on that date is a row saying so, not an absence.
      expect(byRep.get(world.users.nagpurMr.id)).toMatchObject({ status: 'not_started' });
      // Outside the west manager's subtree: not listed.
      expect(byRep.has(world.users.southMr.id)).toBe(false);

      await asUser(client, world.users.puneMr);
      const rep = await outcome(client, 'select * from public.team_work_days($1::date)', [
        day.date,
      ]);
      expect(rep.code).toBe('42501');
    });
  });
});
