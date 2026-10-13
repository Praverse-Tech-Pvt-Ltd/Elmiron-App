import { describe, expect, it } from 'vitest';
import {
  handleAccountRequest,
  temporaryPassword,
} from '../supabase/functions/_shared/account-requests.ts';
import type {
  AccountAdmin,
  CallerRpc,
  RpcResult,
} from '../supabase/functions/_shared/account-requests.ts';

/**
 * `BE-W186` — the `admin-accounts` function's sequencing, with both systems faked.
 *
 * The database's half (who may create whom) is `console-user-admin.spec.ts`. This is the other half:
 * that the account writer is reached ONLY after the caller's RPC said yes, that a failure in either
 * system is reported as what it is, and that an account made without a profile is never reported as
 * a success — or silently.
 */

interface Call {
  readonly fn: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const ok = (data: unknown): RpcResult => ({ data, error: null });
const no = (code: string, message: string): RpcResult => ({ data: null, error: { code, message } });

/** An RPC fake answering by function name, recording every call in order. */
const fakeRpc = (answers: Readonly<Record<string, RpcResult>>) => {
  const calls: Call[] = [];
  const rpc: CallerRpc = (fn, args) => {
    calls.push({ fn, args });
    const answer = answers[fn];
    if (answer === undefined) throw new Error(`unexpected rpc ${fn}`);
    return Promise.resolve(answer);
  };
  return { rpc, calls };
};

const fakeAdmin = (fail: string | null = null) => {
  const made: { email: string; password: string }[] = [];
  const reset: { userId: string; password: string }[] = [];
  const admin: AccountAdmin = {
    createConfirmedUser: (email, password) => {
      if (fail !== null) return Promise.reject(new Error(fail));
      made.push({ email, password });
      return Promise.resolve({ id: 'new-user' });
    },
    setPassword: (userId, password) => {
      if (fail !== null) return Promise.reject(new Error(fail));
      reset.push({ userId, password });
      return Promise.resolve();
    },
  };
  return { admin, made, reset };
};

const CREATE = {
  action: 'create',
  email: 'new.rep@example.test',
  fullName: 'New Rep',
  role: 'mr',
  territoryId: 't-1',
  managerId: 'm-1',
};
const BEGUN = ok({
  provisioningId: 'prov-1',
  email: 'new.rep@example.test',
  existingAccount: false,
});
const USER = { id: 'new-user', email: 'new.rep@example.test', role: 'mr' };

describe('BE-W186 — creating a user', () => {
  it('begins as the caller, creates a CONFIRMED account, finishes as the caller, shows the password once', async () => {
    const { rpc, calls } = fakeRpc({
      admin_begin_user_creation: BEGUN,
      admin_finish_user_creation: ok(USER),
    });
    const { admin, made } = fakeAdmin();
    const result = await handleAccountRequest(CREATE, rpc, admin, () => 'Temp-Password-1');

    expect(result).toEqual({
      status: 200,
      body: { outcome: 'created', user: USER, temporaryPassword: 'Temp-Password-1' },
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'admin_begin_user_creation',
      'admin_finish_user_creation',
    ]);
    expect(calls[0]?.args).toEqual({
      p_email: 'new.rep@example.test',
      p_full_name: 'New Rep',
      p_role: 'mr',
      p_territory_id: 't-1',
      p_reporting_manager_id: 'm-1',
      p_admin_confirmation: null,
    });
    // The address the DATABASE normalised, not the one the browser typed.
    expect(made).toEqual([{ email: 'new.rep@example.test', password: 'Temp-Password-1' }]);
  });

  it('a refusal from the database reaches no account writer, and keeps its own code and words', async () => {
    const { rpc } = fakeRpc({
      admin_begin_user_creation: no('22023', 'rep_needs_manager: a rep must report to a manager'),
    });
    const { admin, made } = fakeAdmin();
    const result = await handleAccountRequest(CREATE, rpc, admin);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: '22023', message: /rep_needs_manager/u });
    expect(made).toEqual([]);
  });

  it('a non-admin is 403, and still reaches no account writer', async () => {
    const { rpc } = fakeRpc({
      admin_begin_user_creation: no(
        '42501',
        'not_an_admin: only an active admin administers users',
      ),
    });
    const { admin, made } = fakeAdmin();
    expect((await handleAccountRequest(CREATE, rpc, admin)).status).toBe(403);
    expect(made).toEqual([]);
  });

  it('GoTrue failing cancels the provisioning with the reason — nothing is left half-open', async () => {
    const { rpc, calls } = fakeRpc({
      admin_begin_user_creation: BEGUN,
      admin_cancel_user_creation: ok({ state: 'cancelled' }),
    });
    const { admin } = fakeAdmin('A user with this email address has already been registered');
    const result = await handleAccountRequest(CREATE, rpc, admin);
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ code: 'account_create_failed' });
    expect(calls.map((c) => c.fn)).toEqual([
      'admin_begin_user_creation',
      'admin_cancel_user_creation',
    ]);
    expect(String(calls[1]?.args['p_reason'])).toMatch(/already been registered/u);
  });

  it('no secret key on the server: 503, cancelled, nothing created', async () => {
    const { rpc, calls } = fakeRpc({
      admin_begin_user_creation: BEGUN,
      admin_cancel_user_creation: ok({ state: 'cancelled' }),
    });
    const result = await handleAccountRequest(CREATE, rpc, null);
    expect(result).toMatchObject({ status: 503, body: { code: 'not_configured' } });
    expect(calls.map((c) => c.fn)).toContain('admin_cancel_user_creation');
  });

  it('the account made and the profile REFUSED is `incomplete`, with the id and the working password', async () => {
    const { rpc } = fakeRpc({
      admin_begin_user_creation: BEGUN,
      admin_finish_user_creation: no('22023', 'manager_invalid: the manager must be active'),
    });
    const { admin, made } = fakeAdmin();
    const result = await handleAccountRequest(CREATE, rpc, admin, () => 'Temp-Password-2');
    expect(made).toHaveLength(1);
    expect(result).toEqual({
      status: 200,
      body: {
        outcome: 'incomplete',
        provisioningId: 'prov-1',
        email: 'new.rep@example.test',
        temporaryPassword: 'Temp-Password-2',
        refusal: { code: '22023', message: 'manager_invalid: the manager must be active' },
      },
    });
  });

  it('an existing profile-less account is ADOPTED: no account made, no password set', async () => {
    const { rpc } = fakeRpc({
      admin_begin_user_creation: ok({
        provisioningId: 'prov-2',
        email: 'made.by.hand@example.test',
        existingAccount: true,
      }),
      admin_finish_user_creation: ok(USER),
    });
    const { admin, made } = fakeAdmin();
    const result = await handleAccountRequest(CREATE, rpc, admin);
    expect(made).toEqual([]);
    expect(result.body).toMatchObject({ outcome: 'adopted', temporaryPassword: null });
  });

  it('a malformed body is refused before any call', async () => {
    const { rpc, calls } = fakeRpc({});
    const { admin } = fakeAdmin();
    expect((await handleAccountRequest({ ...CREATE, role: 'superuser' }, rpc, admin)).status).toBe(
      400,
    );
    expect((await handleAccountRequest({ action: 'delete' }, rpc, admin)).status).toBe(400);
    expect((await handleAccountRequest('create', rpc, admin)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('BE-W186 — resetting a password', () => {
  it('authorizes as the caller first, then sets a new password and shows it once', async () => {
    const { rpc, calls } = fakeRpc({
      admin_authorize_password_reset: ok({ userId: 'u-9', email: 'rep@example.test' }),
    });
    const { admin, reset } = fakeAdmin();
    const result = await handleAccountRequest(
      { action: 'reset_password', userId: 'u-9', reason: 'deactivated: left the company' },
      rpc,
      admin,
      () => 'Temp-Password-3',
    );
    expect(calls[0]).toEqual({
      fn: 'admin_authorize_password_reset',
      args: { p_user_id: 'u-9', p_reason: 'deactivated: left the company' },
    });
    expect(reset).toEqual([{ userId: 'u-9', password: 'Temp-Password-3' }]);
    expect(result.body).toMatchObject({
      outcome: 'password_reset',
      temporaryPassword: 'Temp-Password-3',
    });
  });

  it('a refused authorization changes no password', async () => {
    const { rpc } = fakeRpc({
      admin_authorize_password_reset: no('42501', 'user_not_found: not one of your company'),
    });
    const { admin, reset } = fakeAdmin();
    const result = await handleAccountRequest(
      { action: 'reset_password', userId: 'u-rival', reason: 'curious' },
      rpc,
      admin,
    );
    expect(result.status).toBe(403);
    expect(reset).toEqual([]);
  });
});

describe('BE-W186 — the temporary password', () => {
  it('is 16 characters from the unambiguous alphabet, and not the same twice', () => {
    const a = temporaryPassword();
    const b = temporaryPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/u);
    expect(a).not.toBe(b);
  });
});
