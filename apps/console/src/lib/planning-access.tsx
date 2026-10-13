'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { PLANNING_RPC, PlanningGrantRevocationSchema, PlanningGrantSchema } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import { grantRefusal, grantStateLabel } from './planning-text';
import { btn } from './theme-css';

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
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
          <Label>Until (optional — leave empty for no end date)</Label>
          <input
            aria-label="Until"
            type="date"
            value={until}
            onChange={(e) => {
              setUntil(e.target.value);
            }}
          />
          <Label>Why</Label>
          <input
            aria-label="Why"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          {outcome.kind === 'done' ? <Body>{outcome.message}</Body> : null}
          {outcome.kind === 'refused' ? (
            <MissingNote tone="critical">{outcome.message}</MissingNote>
          ) : null}
          <button type="button" className={btn('primary')} disabled={!ready} onClick={grant}>
            {outcome.kind === 'busy' ? 'Granting…' : 'Grant'}
          </button>
        </Card>
      ) : null}

      <Card>
        <Heading>Grants</Heading>
        {grants.length === 0 ? (
          <Body muted>No planning access has been granted.</Body>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Manager</th>
                <th>Territory</th>
                <th>Dates</th>
                <th>Why</th>
                <th>State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((row) => (
                <GrantLine key={row.id} row={row} canRevoke={canGrant} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
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
      <td>{row.manager}</td>
      <td>{row.territory}</td>
      <td>
        {row.from} – {row.until ?? 'no end'}
      </td>
      <td>{row.reason}</td>
      <td>
        <Pill tone={row.state === 'active' ? 'success' : 'neutral'}>
          {grantStateLabel(row.state)}
        </Pill>
      </td>
      <td>
        {canRevoke && row.state !== 'revoked' ? (
          <div className="ff-cell-stack">
            <input
              aria-label={`Why revoke ${row.manager}'s grant`}
              placeholder="Why it ends"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <button
              type="button"
              className={btn('danger')}
              disabled={reason.trim().length < 3 || outcome.kind === 'busy'}
              onClick={revoke}
            >
              Revoke
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
