'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { WORK_DAY_RPC, WorkDayRowSchema } from '@fieldforce/core';
import type { TeamWorkDay } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, MissingNote, Pill } from './ui';
import { attendance, dayStatusLabel, distanceLabel, reopenRefusal, timeIn } from './team-days-text';
import { btn } from './theme-css';

/**
 * `BE-W191` — the client half of `/days`. The browser sends a day's id and a reason; the database
 * decides whether this manager may reopen it (`reopen_work_day`), and the page is refreshed from the
 * server afterwards rather than patched locally.
 */

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'refused'; readonly message: string };

export const TeamDays = ({ days }: { readonly days: readonly TeamWorkDay[] }): ReactNode =>
  days.length === 0 ? (
    <Body muted>No rep is in your view.</Body>
  ) : (
    <Card>
      <table>
        <thead>
          <tr>
            <th>Rep</th>
            <th>Day</th>
            <th>Started</th>
            <th>Ended</th>
            <th className="ff-num">Visits</th>
            <th className="ff-num">Distance</th>
            <th>Note</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <DayLine day={day} key={day.mr_id} />
          ))}
        </tbody>
      </table>
    </Card>
  );

const DayLine = ({ day }: { readonly day: TeamWorkDay }): ReactNode => {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const reopen = (): void => {
    if (day.work_day_id === null) return;
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(WORK_DAY_RPC.reopenWorkDay, { p_work_day_id: day.work_day_id, p_reason: reason })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: reopenRefusal(error) });
          return;
        }
        WorkDayRowSchema.parse(data);
        setReason('');
        setOutcome({ kind: 'idle' });
        router.refresh();
      });
  };

  const started = timeIn(day.opened_at, day.time_zone);
  const ended = timeIn(day.closed_at, day.time_zone);
  return (
    <tr>
      <td>
        {day.full_name}
        {day.territory_name === null ? null : <Body muted>{day.territory_name}</Body>}
      </td>
      <td>
        <Pill
          tone={day.status === 'closed' ? 'success' : day.status === 'open' ? 'info' : 'neutral'}
        >
          {dayStatusLabel(day.status)}
        </Pill>
        {day.reopen_count > 0 ? (
          <Body muted>
            {day.reopen_count === 1
              ? 'Reopened once'
              : `Reopened ${String(day.reopen_count)} times`}
          </Body>
        ) : null}
      </td>
      <td>{started ?? '—'}</td>
      <td>{ended ?? '—'}</td>
      {/* The snapshot is the server's, taken when the rep ended the day; an open day has none. */}
      <td className="ff-num">{attendance(day) ?? '—'}</td>
      <td className="ff-num">{distanceLabel(day.distance_metres) ?? '—'}</td>
      <td>{day.closing_note ?? '—'}</td>
      <td>
        {day.status === 'closed' ? (
          <div className="ff-cell-stack">
            <input
              aria-label={`Why reopen ${day.full_name}'s day`}
              placeholder="Why it reopens"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <button
              type="button"
              className={btn('secondary')}
              disabled={reason.trim().length < 3 || outcome.kind === 'busy'}
              onClick={reopen}
            >
              {outcome.kind === 'busy' ? 'Reopening…' : 'Reopen the day'}
            </button>
          </div>
        ) : null}
        {outcome.kind === 'refused' ? (
          <MissingNote tone="critical">{outcome.message}</MissingNote>
        ) : null}
      </td>
    </tr>
  );
};
