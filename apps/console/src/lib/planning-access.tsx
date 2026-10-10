'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { PLANNING_RPC, PlanningGrantRevocationSchema, PlanningGrantSchema } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill, cell, headerCell } from './ui';
import { grantRefusal, grantStateLabel } from './planning-text';

/**
 * `BE-W171` — the client half of `/planning/access`. The browser sends ids only; the names in the
 * pickers are for reading, and the database decides whether each id is a manager and a territory
 * of the admin's own company.
 */
export interface Option {
  readonly id: string;
  readonly label: string;
}
export interface GrantRow {
  readonly id: string;
  readonly manager: string;
  readonly territory: string;
  readonly from: string;
  readonly until: string | null;
  readonly reason: string;
  readonly state: 'revoked' | 'ended' | 'not_started' | 'active';
}

const field = (): CSSProperties => ({
  width: '100%',
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

const button = (): CSSProperties => ({
  minHeight: 44,
  padding: `0 ${String(tokens.space.md)}px`,
  background: tokens.color.surface,
  border: `2px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  color: tokens.color.textPrimary,
  fontSize: compactTypography.control.size,
  fontWeight: Number(compactTypography.control.weight),
  cursor: 'pointer',
});

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value);

export const PlanningAccess = ({
  canGrant,
  grants,
  managers,
  territories,
  today,
}: {
  readonly canGrant: boolean;
  readonly grants: readonly GrantRow[];
  readonly managers: readonly Option[];
  readonly territories: readonly Option[];
  readonly today: string;
}): ReactNode => {
  const router = useRouter();
  const [managerId, setManagerId] = useState(managers[0]?.id ?? '');
  const [territoryId, setTerritoryId] = useState(territories[0]?.id ?? '');
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const ready =
    managerId !== '' &&
    territoryId !== '' &&
    isDate(from) &&
    (until === '' || isDate(until)) &&
    reason.trim().length >= 3 &&
    outcome.kind !== 'busy';

  const grant = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(PLANNING_RPC.grantPlanningAccess, {
        p_manager_id: managerId,
        p_territory_id: territoryId,
        p_valid_from: from,
        p_valid_until: until === '' ? null : until,
        p_reason: reason,
      })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: grantRefusal(error) });
          return;
        }
        const row = PlanningGrantSchema.parse(data);
        setOutcome({ kind: 'done', message: `Granted from ${row.valid_from}.` });
        setReason('');
        router.refresh();
      });
  };

  return (
    <>
      {canGrant ? (
        <Card>
          <Heading>Grant planning access</Heading>
          {managers.length === 0 ? (
            <MissingNote>Your company has no active field manager.</MissingNote>
          ) : null}
          <Label>Field manager</Label>
          <select
            aria-label="Field manager"
            style={field()}
            value={managerId}
            onChange={(e) => {
              setManagerId(e.target.value);
            }}
          >
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <Label>Territory (and everything beneath it)</Label>
          <select
            aria-label="Territory"
            style={field()}
            value={territoryId}
            onChange={(e) => {
              setTerritoryId(e.target.value);
            }}
          >
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <Label>From</Label>
          <input
            aria-label="From"
            type="date"
            style={field()}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
          <Label>Until (optional — leave empty for no end date)</Label>
          <input
            aria-label="Until"
            type="date"
            style={field()}
            value={until}
            onChange={(e) => {
              setUntil(e.target.value);
            }}
          />
          <Label>Why</Label>
          <input
            aria-label="Why"
            style={field()}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          {outcome.kind === 'done' ? <Body>{outcome.message}</Body> : null}
          {outcome.kind === 'refused' ? <MissingNote>{outcome.message}</MissingNote> : null}
          <button type="button" style={button()} disabled={!ready} onClick={grant}>
            {outcome.kind === 'busy' ? 'Granting…' : 'Grant'}
          </button>
        </Card>
      ) : null}

      <Heading>Grants</Heading>
      {grants.length === 0 ? (
        <Body muted>No planning access has been granted.</Body>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>Manager</th>
              <th style={headerCell}>Territory</th>
              <th style={headerCell}>Dates</th>
              <th style={headerCell}>Why</th>
              <th style={headerCell}>State</th>
              <th style={headerCell}>Action</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((row) => (
              <GrantLine key={row.id} row={row} canRevoke={canGrant} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};

const GrantLine = ({
  row,
  canRevoke,
}: {
  readonly row: GrantRow;
  readonly canRevoke: boolean;
}): ReactNode => {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const revoke = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(PLANNING_RPC.revokePlanningAccess, { p_grant_id: row.id, p_reason: reason })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: grantRefusal(error) });
          return;
        }
        PlanningGrantRevocationSchema.parse(data);
        router.refresh();
      });
  };

  return (
    <tr>
      <td style={cell}>{row.manager}</td>
      <td style={cell}>{row.territory}</td>
      <td style={cell}>
        {row.from} – {row.until ?? 'no end'}
      </td>
      <td style={cell}>{row.reason}</td>
      <td style={cell}>
        <Pill tone={row.state === 'active' ? 'success' : 'neutral'}>
          {grantStateLabel(row.state)}
        </Pill>
      </td>
      <td style={cell}>
        {canRevoke && row.state !== 'revoked' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
            <input
              aria-label={`Why revoke ${row.manager}'s grant`}
              placeholder="Why it ends"
              style={field()}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <button
              type="button"
              style={button()}
              disabled={reason.trim().length < 3 || outcome.kind === 'busy'}
              onClick={revoke}
            >
              Revoke
            </button>
          </div>
        ) : null}
        {outcome.kind === 'refused' ? <MissingNote>{outcome.message}</MissingNote> : null}
      </td>
    </tr>
  );
};
