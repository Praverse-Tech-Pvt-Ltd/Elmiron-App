import { RoleSchema } from '@fieldforce/core';
import type { Role } from '@fieldforce/core';

/**
 * The role is **read** from the token, never inferred.
 *
 * Backend's `custom_access_token_hook` puts `app_role`, `app_territory_id` and
 * `app_is_active` into the JWT at issue time. Guessing a role from which screens
 * loaded, or from a profile row the client fetched, would be the client deciding
 * its own permissions — and the client never decides permissions here.
 *
 * Two things this deliberately does not do:
 * - **It does not verify the signature.** The server does that on every request.
 *   These claims decide which rows render; they are not a security boundary, and
 *   treating them as one would be the mistake.
 * - **It does not treat `app_is_active` as current.** The claim refreshes at most
 *   hourly, so a deactivated user holds a valid-looking token until then. Backend
 *   re-reads `is_active` from the table for scope, which is why a stale claim
 *   collapses to an empty scope rather than to access.
 *
 * Validation is hand-rolled rather than done with Zod: `zod` is a dependency of
 * `@fieldforce/core`, not of this app, and adding it here to check three fields would
 * be a dependency added for convenience.
 */
export interface AppClaims {
  readonly appRole: Role;
  readonly appTerritoryId: string | null;
  readonly appIsActive: boolean;
}

const HOOK_MISSING =
  'Access token carries no app_role claim. The custom access token hook is not enabled on this Supabase project.';

const decodePayload = (segment: string): unknown => {
  const base64 = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  // atob is available in Hermes from React Native 0.74 onward.
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
};

/**
 * Returns the claims, or throws. A token without them means the app is pointed at a
 * project where the hook is not enabled — a configuration failure that should be
 * loud, not a silent fall back to the least-privileged view.
 */
export const readAppClaims = (accessToken: string): AppClaims => {
  const segments = accessToken.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) {
    throw new Error('Access token is not a JWT.');
  }

  const claims: unknown = decodePayload(payload);
  if (typeof claims !== 'object' || claims === null) throw new Error(HOOK_MISSING);

  const record = claims as Record<string, unknown>;
  const role = RoleSchema.safeParse(record['app_role']);
  if (!role.success) throw new Error(HOOK_MISSING);

  const territoryId = record['app_territory_id'];
  const isActive = record['app_is_active'];

  return {
    appRole: role.data,
    appTerritoryId: typeof territoryId === 'string' ? territoryId : null,
    appIsActive: isActive === true,
  };
};

export type { Role };
