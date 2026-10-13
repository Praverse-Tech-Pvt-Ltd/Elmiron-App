'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { WORK_DAY_RPC, WorkDayRowSchema } from '@fieldforce/core';
import type { TeamWorkDay } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, MissingNote, Pill, cell, headerCell } from './ui';
import { attendance, dayStatusLabel, distanceLabel, reopenRefusal, timeIn } from './team-days-text';
import { btn } from './theme-css';

/**
 * `BE-W191` — the client half of `/days`. The browser sends a day's id and a reason; the database
 * decides whether this manager may reopen it (`reopen_work_day`), and the page is refreshed from the
 * server afterwards rather than patched locally.
 */
const field = (): CSSProperties => ({
  width: '100%',
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'refused'; readonly message: string };

export const TeamDays = ({ days }: { readonly days: readonly TeamWorkDay[] }): ReactNode =>
  days.length === 0 ? (
    <Body muted>No rep is in your view.</Body>
  ) : (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={headerCell}>Rep</th>
          <th style={headerCell}>Day</th>
          <th style={headerCell}>Started</th>
          <th style={headerCell}>Ended</th>
          <th style={headerCell}>Visits</th>
          <th style={headerCell}>Distance</th>
          <th style={headerCell}>Note</th>
          <th style={headerCell}>Action</th>
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <DayLine day={day} key={day.mr_id} />
        ))}
      </tbody>
    </table>
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
      <td style={cell}>
        {day.full_name}
        {day.territory_name === null ? null : <Body muted>{day.territory_name}</Body>}
      </td>
      <td style={cell}>
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
      <td style={cell}>{started ?? '—'}</td>
      <td style={cell}>{ended ?? '—'}</td>
      {/* The snapshot is the server's, taken when the rep ended the day; an open day has none. */}
      <td style={cell}>{attendance(day) ?? '—'}</td>
      <td style={cell}>{distanceLabel(day.distance_metres) ?? '—'}</td>
      <td style={cell}>{day.closing_note ?? '—'}</td>
      <td style={cell}>
        {day.status === 'closed' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
            <input
              aria-label={`Why reopen ${day.full_name}'s day`}
              placeholder="Why it reopens"
              style={field()}
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
