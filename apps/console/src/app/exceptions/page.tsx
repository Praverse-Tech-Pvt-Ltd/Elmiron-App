import type { ReactNode } from 'react';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import { Body, Card, Heading, MissingNote, Page, PageHeader, Pill, RoleNote } from '../../lib/ui';
import { btn } from '../../lib/theme-css';
import { dayLabel, indiaToday, isRealDay } from '../../lib/india-date';
import { MANAGER_RPC, parseAll, parseTeamException } from '../../lib/manager-rows';
import {
  EXCEPTION_KINDS,
  exceptionLabel,
  exceptionMeaning,
  exceptionsByRep,
  exceptionsRefusal,
} from '../../lib/team-exceptions-text';

/**
 * `FE-W202` — what is off-plan for the team on one day, rep by rep.
 *
 * **Nothing here decides who is in the team.** `team_exceptions` answers for the reps the caller may
 * see — a field manager's team, an admin's company — and returns only what is off-plan. Its
 * thresholds are the company's (`app_thresholds`), read by the function, not by this page.
 *
 * **No ranking.** Reps are listed by name; nothing is counted across reps, and a consent-rate
 * difference is shown as the data-quality check it is (`team-exceptions-text.ts`). No audit reason
 * is sent: the function takes none, and the names are a plain read of `user_profiles` under RLS.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team exceptions' };

export default async function TeamExceptions({
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
  // India's date by default (`FE-W125`): the function's own default is the database's UTC date.
  const day = isRealDay(params.date) ? params.date : indiaToday();
  const role = await callerRole();

  const header = (
    <PageHeader title="Team exceptions">
      <Body muted>
        What came up for your reps on {dayLabel(day)}: planned doctors not seen, a phone that has
        not sent anything lately, records the server refused, and checks on the quality of the
        records. Only reps with something to look at are listed, by name.
      </Body>
      <form className="ff-row ff-header-form" method="get">
        <label className="ff-label" htmlFor="exceptions-date">
          Day
        </label>
        <input defaultValue={day} id="exceptions-date" name="date" type="date" />
        <button className={btn('secondary')} type="submit">
          Show
        </button>
      </form>
    </PageHeader>
  );

  if (role === 'mr') {
    return (
      <Page>
        {header}
        <RoleNote>
          This page is for a field manager or an admin, about the reps they look after.
        </RoleNote>
      </Page>
    );
  }

  const result = await session.db.rpc(MANAGER_RPC.teamExceptions, { p_date: day });
  if (result.error !== null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">{exceptionsRefusal(result.error)}</MissingNote>
      </Page>
    );
  }
  const rows = parseAll(result.data, parseTeamException);
  if (rows === null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">
          The exceptions came back in a shape this console does not recognise, so they are not
          shown.
        </MissingNote>
      </Page>
    );
  }

  const ids = [...new Set(rows.map((r) => r.mrId))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await session.db.from('user_profiles').select('id, full_name').in('id', ids);
    for (const profile of (data ?? []) as { id: string; full_name: string }[]) {
      names.set(profile.id, profile.full_name);
    }
  }
  const reps = exceptionsByRep(rows, names);

  return (
    <Page>
      {header}
      {reps.length === 0 ? (
        <MissingNote tone="info">Nothing came up for your team on {dayLabel(day)}.</MissingNote>
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th className="ff-w-sm">Rep</th>
                <th>What came up</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.mrId}>
                  <td className="ff-strong">{rep.name}</td>
                  <td>
                    <div className="ff-stack ff-stack-sm">
                      {rep.items.map((item) => (
                        <div className="ff-cell-stack" key={item.kind}>
                          <div className="ff-row ff-row-tight">
                            <span className="ff-strong">{item.label}</span>
                            {item.dataQuality ? <Pill tone="info">Data quality check</Pill> : null}
                          </div>
                          {item.detail === '' ? null : <Body muted>{item.detail}</Body>}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card>
        <Heading>What each one means</Heading>
        <Body muted>
          Each is a prompt to look, not a verdict. The limits behind them are your company’s
          settings.
        </Body>
        <dl className="ff-defs">
          {EXCEPTION_KINDS.map((kind) => (
            <div key={kind}>
              <dt>{exceptionLabel(kind)}</dt>
              <dd>{exceptionMeaning(kind)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Page>
  );
}
