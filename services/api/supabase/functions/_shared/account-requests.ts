/**
 * `BE-W186` — what the `admin-accounts` Edge Function does with a request, with its two systems
 * passed in, so every branch is testable without Deno, GoTrue or a database.
 *
 * **Who may do what is never decided here.** Each action begins with an RPC run AS THE SIGNED-IN
 * CALLER (`admin_begin_user_creation`, `admin_authorize_password_reset`); those refuse anyone who is
 * not an active admin of the right company, validate the input, and write the audit row. This file
 * only sequences the two systems and reports honestly what happened in each:
 *
 *   create:  begin (as the admin) -> create the confirmed account (the account writer)
 *            -> finish (as the admin: the profile, in the same company)
 *   reset:   authorize (as the admin) -> set a new password (the account writer)
 *
 * **A failure between the two systems is never silent.** If the account is made and the profile is
 * not, the answer is `incomplete` with the provisioning id and the temporary password — the account
 * exists and that password works — and the Users screen lists it under "started, not finished" until
 * an admin finishes or cancels it. If the account cannot be made, the provisioning is cancelled with
 * the reason, so nothing is left half-open.
 *
 * Imports nothing: `practice-writer.ts` imports the `AccountAdmin` type from here, and the vitest
 * suite imports this file directly.
 */

/** The two GoTrue operations `accountAdminFromEnv` hands out. */
export interface AccountAdmin {
  readonly createConfirmedUser: (email: string, password: string) => Promise<{ id: string }>;
  readonly setPassword: (userId: string, password: string) => Promise<void>;
}

/** A PostgREST answer, reduced to what is used: the data, or the SQLSTATE and words of a refusal. */
export type RpcResult =
  | { readonly data: unknown; readonly error: null }
  | {
      readonly data: null;
      readonly error: { readonly code?: string; readonly message: string; readonly hint?: string };
    };

/** An RPC called with the CALLER's token. */
export type CallerRpc = (fn: string, args: Readonly<Record<string, unknown>>) => Promise<RpcResult>;

export interface AccountResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const ROLES = new Set(['mr', 'field_manager', 'admin']);

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * A temporary password: 16 characters from an alphabet with no look-alikes, from the platform's
 * CSPRNG, without modulo bias (a byte over the largest multiple of the alphabet is redrawn).
 */
export const temporaryPassword = (length = 16): string => {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && out.length < length)
        out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return out;
};

/** A database refusal, passed on with its own code and words. 403 for permission, 409 for a clash. */
const refused = (error: { code?: string; message: string; hint?: string }): AccountResponse => ({
  status:
    error.code === '42501'
      ? 403
      : error.code === '23505'
        ? 409
        : error.code === '28000'
          ? 401
          : 400,
  body: { code: error.code ?? 'unknown', message: error.message, hint: error.hint ?? null },
});

const bad = (message: string): AccountResponse => ({
  status: 400,
  body: { code: '22023', message, hint: null },
});

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const createUser = async (
  body: Readonly<Record<string, unknown>>,
  rpc: CallerRpc,
  admin: AccountAdmin | null,
  newPassword: () => string,
): Promise<AccountResponse> => {
  const email = text(body['email']);
  const fullName = text(body['fullName']);
  const role = text(body['role']);
  if (email === null || fullName === null || role === null || !ROLES.has(role)) {
    return bad('create needs an email, a fullName and a role of mr, field_manager or admin');
  }

  const begun = await rpc('admin_begin_user_creation', {
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_territory_id: text(body['territoryId']),
    p_reporting_manager_id: text(body['managerId']),
    p_admin_confirmation: text(body['adminConfirmation']),
  });
  if (begun.error !== null) return refused(begun.error);
  const started = begun.data as { provisioningId: string; email: string; existingAccount: boolean };

  let password: string | null = null;
  if (!started.existingAccount) {
    const cancel = (reason: string) =>
      rpc('admin_cancel_user_creation', {
        p_provisioning_id: started.provisioningId,
        p_reason: reason,
      });
    if (admin === null) {
      await cancel('account creation is not configured on this server (no secret key)');
      return {
        status: 503,
        body: {
          code: 'not_configured',
          message:
            'This server cannot create sign-in accounts: it has no secret key. Nothing was created.',
          hint: null,
        },
      };
    }
    password = newPassword();
    try {
      await admin.createConfirmedUser(started.email, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await cancel(`the sign-in account could not be created: ${message}`.slice(0, 500));
      return {
        status: 502,
        body: {
          code: 'account_create_failed',
          message: `The sign-in account could not be created: ${message}. Nothing was created.`,
          hint: null,
        },
      };
    }
  }

  const finished = await rpc('admin_finish_user_creation', {
    p_provisioning_id: started.provisioningId,
  });
  if (finished.error !== null) {
    // The account exists; its profile does not. Said, with what is needed to finish it.
    return {
      status: 200,
      body: {
        outcome: 'incomplete',
        provisioningId: started.provisioningId,
        email: started.email,
        temporaryPassword: password,
        refusal: { code: finished.error.code ?? 'unknown', message: finished.error.message },
      },
    };
  }
  return {
    status: 200,
    body: {
      outcome: started.existingAccount ? 'adopted' : 'created',
      user: finished.data,
      temporaryPassword: password,
    },
  };
};

const resetPassword = async (
  body: Readonly<Record<string, unknown>>,
  rpc: CallerRpc,
  admin: AccountAdmin | null,
  newPassword: () => string,
): Promise<AccountResponse> => {
  const userId = text(body['userId']);
  if (userId === null) return bad('reset_password needs a userId');

  const allowed = await rpc('admin_authorize_password_reset', {
    p_user_id: userId,
    p_reason: text(body['reason']),
  });
  if (allowed.error !== null) return refused(allowed.error);
  const target = allowed.data as { userId: string; email: string | null };

  if (admin === null) {
    return {
      status: 503,
      body: {
        code: 'not_configured',
        message: 'This server cannot reset passwords: it has no secret key. Nothing was changed.',
        hint: null,
      },
    };
  }
  const password = newPassword();
  try {
    await admin.setPassword(target.userId, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 502,
      body: {
        code: 'password_reset_failed',
        message: `The password could not be reset: ${message}. The old password still works.`,
        hint: null,
      },
    };
  }
  return {
    status: 200,
    body: {
      outcome: 'password_reset',
      userId: target.userId,
      email: target.email,
      temporaryPassword: password,
    },
  };
};

/** One request: `{ action: 'create' | 'reset_password', … }`. */
export const handleAccountRequest = async (
  body: unknown,
  rpc: CallerRpc,
  admin: AccountAdmin | null,
  newPassword: () => string = temporaryPassword,
): Promise<AccountResponse> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return bad('the body is a JSON object');
  }
  const request = body as Readonly<Record<string, unknown>>;
  if (request['action'] === 'create') return createUser(request, rpc, admin, newPassword);
  if (request['action'] === 'reset_password')
    return resetPassword(request, rpc, admin, newPassword);
  return bad('action is create or reset_password');
};
