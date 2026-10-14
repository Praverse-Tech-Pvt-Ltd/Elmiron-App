import type { ReactNode } from 'react';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import { Body, Card, Label, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { btn } from '../../lib/theme-css';
import { indiaToday } from '../../lib/india-date';
import { MANAGER_RPC, parseAll, parseCoverage } from '../../lib/manager-rows';
import {
  asSpan,
  coverageLines,
  coverageRefusal,
  periodOf,
  periodPhrase,
} from '../../lib/coverage-text';
import type { RepFacts } from '../../lib/coverage-text';

/**
 * `FE-W203` — planned against completed visits, per rep, for a day or a week.
 *
 * **Nothing here decides who is counted.** `coverage()` answers for the reps the caller may see, a
 * day at a time, each day reckoned in the rep's own territory zone (`visit_day()`, the same day the
 * rep's phone uses). This page adds the chosen days up and prints them by rep name: plain numbers,
 * neutral type, no percentages and no ordering by any figure.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Visit coverage' };

const isDate = (value: string | undefined): value is string =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value);

export default async function Coverage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly date?: string; readonly span?: string }>;
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
  const day = isDate(params.date) ? params.date : indiaToday();
  const span = asSpan(params.span);
  const period = periodOf(day, span);
  const role = await callerRole();

  const header = (
    <PageHeader title="Visit coverage">
      <Body muted>
        {periodPhrase(period)}, for each rep: the visits on their plan, the visits they completed
        (planned or not), and the planned doctors with no completed visit, shown as not seen. Reps
        are listed by name.
      </Body>
      <form className="ff-row ff-header-form" method="get">
        <span className="ff-row ff-row-tight">
          <label className="ff-label" htmlFor="coverage-date">
            Day
          </label>
          <input defaultValue={day} id="coverage-date" name="date" type="date" />
        </span>
        <span className="ff-row ff-row-tight">
          <label className="ff-label" htmlFor="coverage-span">
            Period
          </label>
          <select defaultValue={span} id="coverage-span" name="span">
            <option value="day">That day</option>
            <option value="week">Its week, Monday to Sunday</option>
          </select>
        </span>
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

  const result = await session.db.rpc(MANAGER_RPC.coverage, {
    p_from: period.from,
    p_to: period.to,
  });
  if (result.error !== null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">{coverageRefusal(result.error)}</MissingNote>
      </Page>
    );
  }
  const rows = parseAll(result.data, parseCoverage);
  if (rows === null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">
          Visit coverage came back in a shape this console does not recognise, so it is not shown.
        </MissingNote>
      </Page>
    );
  }

  const ids = [...new Set(rows.map((r) => r.mrId))];
  const reps = new Map<string, RepFacts>();
  if (ids.length > 0) {
    const { data } = await session.db
      .from('user_profiles')
      .select('id, full_name, is_active')
      .in('id', ids);
    for (const p of (data ?? []) as { id: string; full_name: string; is_active: boolean }[]) {
      reps.set(p.id, { name: p.full_name, active: p.is_active });
    }
  }
  const lines = coverageLines(rows, reps);

  return (
    <Page>
      {header}
      {lines.length === 0 ? (
        <MissingNote tone="info">No rep is in your view.</MissingNote>
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th className="ff-num">Planned</th>
                <th className="ff-num">Completed</th>
                <th className="ff-num">Not seen</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.mrId}>
                  <td>
                    <div className="ff-cell-stack">
                      <span>{line.name}</span>
                      {line.utcDays ? (
                        <Label>
                          Days counted on UTC dates: this rep’s territory has no working hours set.
                        </Label>
                      ) : null}
                    </div>
                  </td>
                  <td className="ff-num ff-count">{line.planned}</td>
                  <td className="ff-num ff-count">{line.completed}</td>
                  <td className="ff-num ff-count">{line.notSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
