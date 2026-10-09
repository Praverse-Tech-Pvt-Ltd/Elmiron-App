import type { Client } from 'pg';

/**
 * A fixture's BUSINESS DAY, decided by an explicit date — never by the wall clock's time of day.
 *
 * **Why this exists (10 October).** Two suites seeded rows at "now minus one hour" and then asked for
 * "today" in the territory's zone (`manager.spec.ts`, consents; `manager-planning.spec.ts`, an
 * unplanned visit). Between 00:00 and 01:00 local time that hour is YESTERDAY, so both failed every
 * night for an hour — and a sibling test that expected NOTHING passed vacuously in the same hour,
 * because it was looking at a day with no data in it.
 *
 * **The rule:** a fixture names its day `date`, and every timestamp it writes is a LOCAL time of that
 * day (`at('12:00')`), converted by Postgres with the same zone the product buckets by. Which day it
 * is still comes from a clock — the database's `now()`, or a frozen `asOf` — but the day is always
 * the one BEFORE that clock's local date, so:
 *   - every instant of it, 00:00 to 23:59, is already in the past (the server refuses events from
 *     the future), whatever time the suite runs;
 *   - it is at most 48 hours old (inside `consent_max_sync_lag_hours`, 72);
 *   - and the time of day the suite runs at no longer decides which day a row falls in.
 */
export interface WorkingDay {
  /** `YYYY-MM-DD`, in `zone`. */
  readonly date: string;
  readonly zone: string;
  /** The instant `hh:mm` local time on `date` (+ `dayOffset` days), as an ISO timestamp. */
  readonly at: (hhmm: string, dayOffset?: number) => Promise<string>;
}

export const workingDay = async (
  client: Client,
  zone: string,
  /** A frozen clock (any ISO instant). Omitted: the database's `now()`. */
  asOf?: string,
): Promise<WorkingDay> => {
  const day = await client.query<{ d: string }>(
    `select ((coalesce($2::timestamptz, now()) at time zone $1)::date - 1)::text as d`,
    [zone, asOf ?? null],
  );
  const date = day.rows[0]?.d;
  if (date === undefined) throw new Error('workingDay: no date');
  return {
    date,
    zone,
    at: async (hhmm, dayOffset = 0) => {
      const instant = await client.query<{ t: string }>(
        `select to_json((($1::date + $2::int) + $3::time) at time zone $4) #>> '{}' as t`,
        [date, dayOffset, hhmm, zone],
      );
      const t = instant.rows[0]?.t;
      if (t === undefined) throw new Error('workingDay: no instant');
      return t;
    },
  };
};

/** The instant `hh:mm` local time TODAY in `zone` — a frozen clock for `workingDay(…, asOf)`. */
export const localClock = async (client: Client, zone: string, hhmm: string): Promise<string> => {
  const r = await client.query<{ t: string }>(
    `select to_json(((now() at time zone $1)::date + $2::time) at time zone $1) #>> '{}' as t`,
    [zone, hhmm],
  );
  const t = r.rows[0]?.t;
  if (t === undefined) throw new Error('localClock: no instant');
  return t;
};
