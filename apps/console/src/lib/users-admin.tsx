'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ADMIN_ACCOUNTS_FUNCTION,
  ADMIN_RPC,
  AccountOutcomeSchema,
  AccountRefusalSchema,
  AdminUserSchema,
  ROLES,
} from '@fieldforce/core';
import type {
  AccountOutcome,
  AdminUser,
  CreateAccountRequest,
  PendingUser,
  ResetPasswordRequest,
  Role,
  TerritoryNode,
} from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import {
  accessWarnings,
  adminRefusal,
  managersFor,
  roleLabel,
  territoriesFor,
  territoryOption,
} from './admin-text';
import { btn } from './theme-css';

/**
 * `FE-W75` — the client half of `/users`. The browser sends ids and words; every rule is the
 * database's, and each refusal is named by `adminRefusal`.
 *
 * **The temporary password is shown once, here, and nowhere else.** It is not stored by the console
 * or the database; reloading the page loses it, and the screen says so.
 */

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string; readonly password?: string | null }
  | { readonly kind: 'refused'; readonly message: string };

/** The `admin-accounts` function, with its refusal read from the body rather than the status. */
const invokeAccounts = async (
  body: CreateAccountRequest | ResetPasswordRequest,
): Promise<{ ok: true; outcome: AccountOutcome } | { ok: false; message: string }> => {
  // supabase-js types the error as `any`; it is a FunctionsError carrying the Response as `context`.
  const answer: { data: unknown; error: { message: string; context?: unknown } | null } =
    await browserClient().functions.invoke<unknown>(ADMIN_ACCOUNTS_FUNCTION, { body });
  const { data, error } = answer;
  if (error !== null) {
    const context = error.context;
    if (context instanceof Response) {
      try {
        const refusal = AccountRefusalSchema.safeParse(await context.json());
        if (refusal.success) {
          const sentence = adminRefusal(refusal.data);
          return {
            ok: false,
            message: /_failed$/u.test(refusal.data.code)
              ? `${sentence} ${refusal.data.message}`
              : sentence,
          };
        }
      } catch {
        // Not JSON: fall through to the transport's own words.
      }
    }
    return { ok: false, message: `The account service could not be reached: ${error.message}` };
  }
  const parsed = AccountOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        'The account service answered in a shape this console does not recognise. Reload the page before trying again: something may have been created.',
    };
  }
  return { ok: true, outcome: parsed.data };
};

const Password = ({ value }: { readonly value: string }): ReactNode => (
  <MissingNote tone="info">
    Temporary password, shown once — copy it now and give it to the person directly:{' '}
    <code className="ff-secret">{value}</code>. It is not stored anywhere and is gone when this page
    reloads.
  </MissingNote>
);

const Outcomes = ({ outcome }: { readonly outcome: Outcome }): ReactNode => (
  <>
    {outcome.kind === 'done' ? <Body>{outcome.message}</Body> : null}
    {outcome.kind === 'done' && outcome.password !== undefined && outcome.password !== null ? (
      <Password value={outcome.password} />
    ) : null}
    {outcome.kind === 'refused' ? (
      <MissingNote tone="critical">{outcome.message}</MissingNote>
    ) : null}
  </>
);

interface Pickers {
  readonly users: readonly AdminUser[];
  readonly territories: readonly TerritoryNode[];
}

/** Role, territory and manager — the three that are checked as one combination. */
const Placement = ({
  pickers,
  self,
  role,
  territoryId,
  managerId,
  onRole,
  onTerritory,
  onManager,
}: {
  readonly pickers: Pickers;
  readonly self: string | null;
  readonly role: Role;
  readonly territoryId: string;
  readonly managerId: string;
  readonly onRole: (role: Role) => void;
  readonly onTerritory: (id: string) => void;
  readonly onManager: (id: string) => void;
}): ReactNode => {
  const territories = territoriesFor(role, pickers.territories);
  const managerIds = new Set(managersFor(pickers.users, self));
  const managers = pickers.users.filter((u) => managerIds.has(u.id));
  return (
    <>
      <Label>Role</Label>
      <select
        aria-label="Role"
        value={role}
        onChange={(e) => {
          onRole(e.target.value as Role);
        }}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      {role === 'admin' ? (
        <Body muted>An admin sees the whole company and has no territory or manager.</Body>
      ) : (
        <>
          <Label>
            Territory{role === 'mr' ? ' (an Area/Territory — the lowest level of its branch)' : ''}
          </Label>
          <select
            aria-label="Territory"
            value={territoryId}
            onChange={(e) => {
              onTerritory(e.target.value);
            }}
          >
            <option value="">Choose a territory…</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {territoryOption(t)}
              </option>
            ))}
          </select>
          <Label>Reporting manager{role === 'mr' ? ' (required for a rep)' : ' (optional)'}</Label>
          <select
            aria-label="Reporting manager"
            value={managerId}
            onChange={(e) => {
              onManager(e.target.value);
            }}
          >
            <option value="">{role === 'mr' ? 'Choose a manager…' : 'No manager'}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} — {roleLabel(m.role)}
                {m.territoryCode === null ? '' : ` · ${m.territoryCode}`}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
};

const CreateUser = ({ pickers }: { readonly pickers: Pickers }): ReactNode => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('mr');
  const [territoryId, setTerritoryId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [confirm, setConfirm] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const ready =
    email.trim() !== '' &&
    fullName.trim() !== '' &&
    (role === 'admin'
      ? confirm.trim() !== ''
      : territoryId !== '' && (role !== 'mr' || managerId !== '')) &&
    outcome.kind !== 'busy';

  const create = (): void => {
    setOutcome({ kind: 'busy' });
    void invokeAccounts({
      action: 'create',
      email,
      fullName,
      role,
      territoryId: role === 'admin' ? null : territoryId,
      managerId: role === 'admin' || managerId === '' ? null : managerId,
      adminConfirmation: role === 'admin' ? confirm : null,
    }).then((result) => {
      if (!result.ok) {
        setOutcome({ kind: 'refused', message: result.message });
        return;
      }
      const o = result.outcome;
      if (o.outcome === 'incomplete') {
        setOutcome({
          kind: 'refused',
          message: `The sign-in account for ${o.email} was created, but its profile was refused: ${adminRefusal(o.refusal)} It is listed under “Started, not finished” below.${o.temporaryPassword === null ? '' : ` Its temporary password is ${o.temporaryPassword} — shown once.`}`,
        });
      } else if (o.outcome === 'password_reset') {
        setOutcome({ kind: 'refused', message: 'Unexpected answer: a password reset.' });
      } else {
        setOutcome({
          kind: 'done',
          message:
            o.outcome === 'adopted'
              ? `${o.user.fullName} (${o.user.email ?? ''}) already had a sign-in account; it now has its profile. Its password is unchanged.`
              : `Created ${o.user.fullName} (${o.user.email ?? ''}) as ${roleLabel(o.user.role)}.`,
          password: o.temporaryPassword,
        });
        setEmail('');
        setFullName('');
        setConfirm('');
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <Heading>Add a user</Heading>
      <Label>Email</Label>
      <input
        aria-label="Email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
      />
      <Label>Full name</Label>
      <input
        aria-label="Full name"
        value={fullName}
        onChange={(e) => {
          setFullName(e.target.value);
        }}
      />
      <Placement
        pickers={pickers}
        self={null}
        role={role}
        territoryId={territoryId}
        managerId={managerId}
        onRole={(r) => {
          setRole(r);
          setTerritoryId('');
          setManagerId('');
        }}
        onTerritory={setTerritoryId}
        onManager={setManagerId}
      />
      {role === 'admin' ? (
        <>
          <MissingNote>
            An admin reads the whole company’s data. To confirm, type the new admin’s email address
            again.
          </MissingNote>
          <Label>Email again</Label>
          <input
            aria-label="Email again"
            autoComplete="off"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </>
      ) : null}
      <Outcomes outcome={outcome} />
      <button type="button" className={btn('primary')} disabled={!ready} onClick={create}>
        {outcome.kind === 'busy' ? 'Creating…' : 'Create user'}
      </button>
    </Card>
  );
};

const PendingLine = ({ row }: { readonly row: PendingUser }): ReactNode => {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const run = (fn: string, args: Record<string, unknown>): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(fn, args)
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: adminRefusal(error) });
          return;
        }
        router.refresh();
      });
  };

  return (
    <tr>
      <td>
        {row.fullName}
        <br />
        <span className="ff-muted">{row.email}</span>
      </td>
      <td>{roleLabel(row.role)}</td>
      <td>
        {row.accountExists
          ? row.accountConfirmed
            ? 'Account exists, confirmed — no profile yet'
            : 'Account exists, NOT confirmed'
          : 'No sign-in account'}
      </td>
      <td>{row.requestedBy}</td>
      <td>
        <div className="ff-cell-stack">
          {row.accountExists && !row.accountHasProfile ? (
            <button
              type="button"
              className={btn('primary')}
              disabled={outcome.kind === 'busy'}
              onClick={() => {
                run(ADMIN_RPC.finishUserCreation, { p_provisioning_id: row.id });
              }}
            >
              Finish
            </button>
          ) : null}
          <input
            aria-label={`Why cancel ${row.email}`}
            placeholder="Why cancel"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <button
            type="button"
            className={btn('danger')}
            disabled={reason.trim().length < 3 || outcome.kind === 'busy'}
            onClick={() => {
              run(ADMIN_RPC.cancelUserCreation, { p_provisioning_id: row.id, p_reason: reason });
            }}
          >
            Cancel creation
          </button>
          <Outcomes outcome={outcome} />
        </div>
      </td>
    </tr>
  );
};

const UserLine = ({
  user,
  pickers,
  selfId,
}: {
  readonly user: AdminUser;
  readonly pickers: Pickers;
  readonly selfId: string;
}): ReactNode => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [territoryId, setTerritoryId] = useState(user.territoryId ?? '');
  const [managerId, setManagerId] = useState(user.managerId ?? '');
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [suggestReset, setSuggestReset] = useState(false);
  const isSelf = user.id === selfId;
  const reasoned = reason.trim().length >= 3 && outcome.kind !== 'busy';

  const save = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(ADMIN_RPC.updateUser, {
        p_user_id: user.id,
        p_full_name: fullName,
        p_role: role,
        p_territory_id: role === 'admin' || territoryId === '' ? null : territoryId,
        p_reporting_manager_id: role === 'admin' || managerId === '' ? null : managerId,
        p_admin_confirmation: role === 'admin' ? confirm : null,
        p_reason: reason,
      })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: adminRefusal(error) });
          return;
        }
        const saved = AdminUserSchema.parse(data);
        setOutcome({
          kind: 'done',
          message: `Saved. ${saved.role === user.role ? '' : 'A role change reaches the app at their next sign-in; what they may read changes now.'}`,
        });
        setReason('');
        setOpen(false);
        router.refresh();
      });
  };

  const setActive = (active: boolean): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(ADMIN_RPC.setUserActive, { p_user_id: user.id, p_active: active, p_reason: reason })
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: adminRefusal(error) });
          return;
        }
        setOutcome({
          kind: 'done',
          message: active
            ? 'Reactivated. If they no longer know their password, reset it.'
            : 'Deactivated: they can no longer read or change anything. Their password still signs in to an empty app — reset it so the old one stops working.',
        });
        setSuggestReset(!active);
        router.refresh();
      });
  };

  const resetPassword = (): void => {
    setOutcome({ kind: 'busy' });
    void invokeAccounts({ action: 'reset_password', userId: user.id, reason }).then((result) => {
      if (!result.ok) {
        setOutcome({ kind: 'refused', message: result.message });
        return;
      }
      const o = result.outcome;
      setOutcome({
        kind: 'done',
        message: 'Password reset. The old password no longer works.',
        password: o.outcome === 'password_reset' ? o.temporaryPassword : null,
      });
      setSuggestReset(false);
      setReason('');
    });
  };

  const warnings = accessWarnings(user);

  return (
    <tr>
      <td>
        <strong>{user.fullName}</strong>
        {isSelf ? ' (you)' : ''}
        <br />
        <span className="ff-muted">{user.email ?? 'no email'}</span>
      </td>
      <td>{roleLabel(user.role)}</td>
      <td>
        {user.territoryCode === null ? '—' : `${user.territoryCode} — ${user.territoryName ?? ''}`}
      </td>
      <td>{user.managerName ?? '—'}</td>
      <td>
        <div className="ff-cell-stack">
          <Pill tone={user.isActive ? 'success' : 'neutral'}>
            {user.isActive ? 'Active' : 'Deactivated'}
          </Pill>
          {warnings.map((w) => (
            <Pill key={w} tone="attention">
              {w}
            </Pill>
          ))}
        </div>
      </td>
      <td>
        <div className="ff-cell-stack ff-cell-actions">
          {open ? (
            <>
              <Label>Full name</Label>
              <input
                aria-label={`Full name of ${user.fullName}`}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                }}
              />
              <Placement
                pickers={pickers}
                self={user.id}
                role={role}
                territoryId={territoryId}
                managerId={managerId}
                onRole={setRole}
                onTerritory={setTerritoryId}
                onManager={setManagerId}
              />
              {role === 'admin' && user.role !== 'admin' ? (
                <>
                  <Label>Their email again, to confirm the admin role</Label>
                  <input
                    aria-label={`Email of ${user.fullName} again`}
                    autoComplete="off"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                    }}
                  />
                </>
              ) : null}
            </>
          ) : null}
          {isSelf ? (
            <Body muted>Another admin changes your role or access.</Body>
          ) : (
            <>
              <input
                aria-label={`Why change ${user.fullName}`}
                placeholder="Why (kept in the audit log)"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
              <div className="ff-row ff-row-tight">
                {open ? (
                  <button
                    type="button"
                    className={btn('primary')}
                    disabled={!reasoned}
                    onClick={save}
                  >
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btn('secondary')}
                    onClick={() => {
                      setOpen(true);
                    }}
                  >
                    Change
                  </button>
                )}
                {user.isActive ? (
                  <button
                    type="button"
                    className={btn('danger')}
                    disabled={!reasoned}
                    onClick={() => {
                      setActive(false);
                    }}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btn('secondary')}
                    disabled={!reasoned}
                    onClick={() => {
                      setActive(true);
                    }}
                  >
                    Reactivate
                  </button>
                )}
                <button
                  type="button"
                  className={btn(suggestReset ? 'primary' : 'quiet')}
                  disabled={!reasoned}
                  onClick={resetPassword}
                >
                  Reset password
                </button>
              </div>
            </>
          )}
          <Outcomes outcome={outcome} />
        </div>
      </td>
    </tr>
  );
};

export const UsersAdmin = ({
  selfId,
  users,
  pending,
  territories,
}: {
  readonly selfId: string;
  readonly users: readonly AdminUser[];
  readonly pending: readonly PendingUser[];
  readonly territories: readonly TerritoryNode[];
}): ReactNode => {
  const pickers: Pickers = { users, territories };
  const admins = users.filter((u) => u.role === 'admin' && u.isActive).length;
  return (
    <>
      <CreateUser pickers={pickers} />

      {admins < 2 ? (
        <MissingNote tone="info">
          Your company has {String(admins)} active admin. Approvals need a second admin (four-eyes):
          add one with the Admin role above.
        </MissingNote>
      ) : null}

      {pending.length === 0 ? null : (
        <Card>
          <Heading>Started, not finished</Heading>
          <Body muted>
            A sign-in account and its profile are made in two systems. These were started and did
            not finish — finish each once its account exists, or cancel it.
          </Body>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Sign-in account</th>
                <th>Started by</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <PendingLine key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <Heading>People</Heading>
        <Body muted>
          Read this list against the sheet you were given: role, territory and manager for every
          person, and no warning on anyone who should be working.
        </Body>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Territory</th>
              <th>Reports to</th>
              <th>State</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserLine key={user.id} user={user} pickers={pickers} selfId={selfId} />
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};
