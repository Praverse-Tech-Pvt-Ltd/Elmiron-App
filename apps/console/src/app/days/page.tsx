import type { ReactNode } from 'react';
import { TeamWorkDaySchema, WORK_DAY_RPC } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { TeamDays } from '../../lib/team-days';
import { teamDaysRefusal } from '../../lib/team-days-text';
import { btn } from '../../lib/theme-css';

/**
 * `BE-W191` — the team's working days on one date: who started, who ended, what each day held.
 *
 * **Nothing here decides who is in the team.** `team_work_days` lists every active rep the caller
 * may see -- a field manager their team, an admin their company -- with or without a day; a rep who
 * has not started is a row saying so, not an absence. The figures are the server's snapshot, taken
 * when the rep ended the day. Reopening an ended day is `reopen_work_day`, which checks again and
 * keeps the undone close with the reason.
 */
export const dynamic = 'force-dynamic';

const isDate = (value: string | undefined): value is string =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value);

export default async function TeamDaysPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly date?: string }>;
}): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const params = await searchParams;
  // The default is the server's date, as `/planning`'s is. A rep's day is reckoned in their own
  // territory's zone, and each row's times are shown in that zone.
  const day = isDate(params.date) ? params.date : new Date().toISOString().slice(0, 10);

  const result = await session.db.rpc(WORK_DAY_RPC.teamWorkDays, { p_on: day });
  const header = (
    <div className="ff-page-header-text">
      <Title>The team’s day</Title>
      <Body muted>
        Each rep’s working day on {day}: started with their first check-in or when they started it,
        ended when they pressed End my day. An ended day refuses further check-ins until you reopen
        it, and the reason you give is kept with it.
      </Body>
      <form className="ff-row" method="get" style={{ marginTop: tokens.space.sm }}>
        <label className="ff-label" htmlFor="days-date">
          Day
        </label>
        <input defaultValue={day} id="days-date" name="date" type="date" />
        <button className={btn('secondary')} type="submit">
          Show
        </button>
      </form>
    </div>
  );

  if (result.error !== null) {
    return (
      <div className="ff-page ff-page-medium">
        {header}
        <MissingNote tone="critical">{teamDaysRefusal(result.error)}</MissingNote>
      </div>
    );
  }

  const days = ((result.data ?? []) as unknown[]).map((row) => TeamWorkDaySchema.parse(row));
  return (
    <div className="ff-page ff-page-medium">
      {header}
      <TeamDays days={days} />
    </div>
  );
}
