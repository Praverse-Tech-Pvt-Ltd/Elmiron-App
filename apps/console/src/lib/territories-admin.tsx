'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ADMIN_RPC, territoryLevel } from '@fieldforce/core';
import type { TerritoryNode } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, cell, headerCell } from './ui';
import { adminRefusal, clock, hoursSource, treeOrder, weekdaysLabel } from './admin-text';
import { btn } from './theme-css';

/**
 * `FE-W76` — the client half of `/territories`. Every write is an RPC as the signed-in admin; the
 * level rules, the code rules and the hours rules are the database's, named by `adminRefusal`.
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

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

/** One write, then a refresh; a refusal stays on screen in words. */
const useWrite = () => {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const write = (fn: string, args: Record<string, unknown>, after?: () => void): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(fn, args)
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: adminRefusal(error) });
          return;
        }
        setOutcome({ kind: 'idle' });
        after?.();
        router.refresh();
      });
  };
  return { outcome, write };
};

const Refused = ({ outcome }: { readonly outcome: Outcome }): ReactNode =>
  outcome.kind === 'refused' ? <MissingNote tone="critical">{outcome.message}</MissingNote> : null;

/** Name and code for a new territory, beneath `parent` (or at the top). */
const AddTerritory = ({
  parent,
  onDone,
}: {
  readonly parent: TerritoryNode | null;
  readonly onDone?: () => void;
}): ReactNode => {
  const { outcome, write } = useWrite();
  const [name, setName] = useState('');
  const [code, setCode] = useState(parent === null ? '' : `${parent.code}-`);
  const level = territoryLevel(parent === null ? 1 : parent.depth + 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <Label>
        New {level}
        {parent === null ? '' : ` beneath ${parent.code}`}
      </Label>
      <input
        aria-label={`Name of the new ${level}`}
        placeholder="Name"
        style={field()}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <input
        aria-label={`Code of the new ${level}`}
        placeholder="Code (unique across the whole system)"
        style={field()}
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
        }}
      />
      <Refused outcome={outcome} />
      <button
        type="button"
        className={btn('primary')}
        disabled={name.trim() === '' || code.trim() === '' || outcome.kind === 'busy'}
        onClick={() => {
          write(
            ADMIN_RPC.createTerritory,
            { p_name: name, p_code: code, p_parent_id: parent?.id ?? null },
            () => {
              setName('');
              setCode(parent === null ? '' : `${parent.code}-`);
              onDone?.();
            },
          );
        }}
      >
        Add {level}
      </button>
    </div>
  );
};

const Hours = ({
  node,
  onDone,
}: {
  readonly node: TerritoryNode;
  readonly onDone: () => void;
}): ReactNode => {
  const { outcome, write } = useWrite();
  const base = node.ownHours ?? node.hours;
  const [start, setStart] = useState(clock(base?.shiftStart ?? '09:00'));
  const [end, setEnd] = useState(clock(base?.shiftEnd ?? '18:00'));
  const [zone, setZone] = useState(base?.timezone ?? 'Asia/Kolkata');
  const [grace, setGrace] = useState(String(base?.graceMinutes ?? 15));
  const [days, setDays] = useState<readonly number[]>(base?.activeWeekdays ?? [1, 2, 3, 4, 5, 6]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <Label>Working hours for {node.code}</Label>
      <div style={{ display: 'flex', gap: tokens.space.xs }}>
        <input
          aria-label={`Start of day in ${node.code}`}
          type="time"
          style={field()}
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
          }}
        />
        <input
          aria-label={`End of day in ${node.code}`}
          type="time"
          style={field()}
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
          }}
        />
      </div>
      <input
        aria-label={`Time zone of ${node.code}`}
        style={field()}
        value={zone}
        onChange={(e) => {
          setZone(e.target.value);
        }}
      />
      <Label>Grace, in minutes</Label>
      <input
        aria-label={`Grace minutes in ${node.code}`}
        type="number"
        min={0}
        max={240}
        style={field()}
        value={grace}
        onChange={(e) => {
          setGrace(e.target.value);
        }}
      />
      <div style={{ display: 'flex', gap: tokens.space.sm, flexWrap: 'wrap' }}>
        {DAYS.map(([day, label]) => (
          <label key={day} style={{ fontSize: compactTypography.body.size }}>
            <input
              type="checkbox"
              checked={days.includes(day)}
              onChange={(e) => {
                setDays(e.target.checked ? [...days, day] : days.filter((d) => d !== day));
              }}
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <Refused outcome={outcome} />
      <div style={{ display: 'flex', gap: tokens.space.xs, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={btn('primary')}
          disabled={outcome.kind === 'busy'}
          onClick={() => {
            write(
              ADMIN_RPC.setTerritoryHours,
              {
                p_territory_id: node.id,
                p_shift_start: start,
                p_shift_end: end,
                p_timezone: zone.trim(),
                p_grace_minutes: Number.parseInt(grace, 10),
                p_active_weekdays: [...days].sort((a, b) => a - b),
              },
              onDone,
            );
          }}
        >
          Save hours
        </button>
        {node.ownHours === null ? null : (
          <button
            type="button"
            className={btn('secondary')}
            disabled={outcome.kind === 'busy'}
            onClick={() => {
              write(ADMIN_RPC.clearTerritoryHours, { p_territory_id: node.id }, onDone);
            }}
          >
            Remove own hours (inherit)
          </button>
        )}
      </div>
    </div>
  );
};

const Rename = ({
  node,
  onDone,
}: {
  readonly node: TerritoryNode;
  readonly onDone: () => void;
}): ReactNode => {
  const { outcome, write } = useWrite();
  const [name, setName] = useState(node.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <Label>Rename {node.code} (the code does not change)</Label>
      <input
        aria-label={`New name of ${node.code}`}
        style={field()}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <Refused outcome={outcome} />
      <button
        type="button"
        className={btn('primary')}
        disabled={name.trim() === '' || outcome.kind === 'busy'}
        onClick={() => {
          write(ADMIN_RPC.renameTerritory, { p_territory_id: node.id, p_name: name }, onDone);
        }}
      >
        Rename
      </button>
    </div>
  );
};

type Panel = 'none' | 'hours' | 'rename' | 'add';

const Line = ({
  node,
  indent,
  canEdit,
  codeOf,
}: {
  readonly node: TerritoryNode;
  readonly indent: number;
  readonly canEdit: boolean;
  readonly codeOf: (id: string) => string | undefined;
}): ReactNode => {
  const [panel, setPanel] = useState<Panel>('none');
  const close = (): void => {
    setPanel('none');
  };
  const canAdd = node.depth < 3 && node.reps === 0;
  return (
    <tr>
      <td style={{ ...cell, paddingLeft: tokens.space.md + indent * 24 }}>
        <span style={{ color: tokens.color.textSecondary }}>{territoryLevel(node.depth)}</span>
        <br />
        <strong>{node.code}</strong> — {node.name}
      </td>
      <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>
        {node.activeUsers} ({node.reps} rep{node.reps === 1 ? '' : 's'})
      </td>
      <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{node.doctors}</td>
      <td style={cell}>
        {node.hours === null
          ? '—'
          : `${clock(node.hours.shiftStart)}–${clock(node.hours.shiftEnd)} · ${weekdaysLabel(node.hours.activeWeekdays)} · ${node.hours.timezone}`}
        <br />
        <span style={{ color: tokens.color.textSecondary }}>{hoursSource(node, codeOf)}</span>
      </td>
      {canEdit ? (
        <td style={cell}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space.xs,
              minWidth: 240,
            }}
          >
            <div style={{ display: 'flex', gap: tokens.space.xs, flexWrap: 'wrap' }}>
              {(['hours', 'rename', 'add'] as const)
                .filter((p) => p !== 'add' || canAdd)
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={btn(panel === p ? 'primary' : 'secondary')}
                    onClick={() => {
                      setPanel(panel === p ? 'none' : p);
                    }}
                  >
                    {p === 'hours' ? 'Hours' : p === 'rename' ? 'Rename' : 'Add beneath'}
                  </button>
                ))}
            </div>
            {panel === 'hours' ? <Hours node={node} onDone={close} /> : null}
            {panel === 'rename' ? <Rename node={node} onDone={close} /> : null}
            {panel === 'add' ? <AddTerritory parent={node} onDone={close} /> : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
};

export const TerritoriesAdmin = ({
  canEdit,
  nodes,
}: {
  readonly canEdit: boolean;
  readonly nodes: readonly TerritoryNode[];
}): ReactNode => {
  const codes = new Map(nodes.map((n) => [n.id, n.code]));
  const codeOf = (id: string): string | undefined => codes.get(id);
  const ordered = treeOrder(nodes);
  return (
    <>
      {canEdit ? (
        <Card>
          <Heading>Add a National territory</Heading>
          <Body muted>
            Regions and Areas are added beneath their parent, in the table. A code is unique across
            the whole system, not only your company.
          </Body>
          <AddTerritory parent={null} />
        </Card>
      ) : null}
      {ordered.length === 0 ? (
        <Body muted>No territories yet.</Body>
      ) : (
        <table className="ff-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>Territory</th>
              <th style={headerCell}>Active users</th>
              <th style={headerCell}>Doctors</th>
              <th style={headerCell}>Working hours</th>
              {canEdit ? <th style={headerCell}>Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {ordered.map(({ node, indent }) => (
              <Line key={node.id} node={node} indent={indent} canEdit={canEdit} codeOf={codeOf} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};
