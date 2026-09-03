import { describe, expect, it } from 'vitest';
import { requireDatabase, withClient } from './db.js';
import { SERVICE_ROLE_KEY, API_URL } from './auth.js';
import { parseSeedMrArgs, seedOneMr, verifySignIn } from '../scripts/seed-one-mr.mjs';
import type { SeededUser } from '../scripts/seed-one-mr.d.mts';

/**
 * The seed script, under test — which it never was.
 *
 * It shipped importing `../tests/fixtures.js` from a `.mjs` file, which cannot
 * resolve: `fixtures.ts` is NodeNext TypeScript and Node does not rewrite a `.js`
 * specifier to a `.ts` file. Nothing ran it, no script pointed at it, and the
 * breakage survived because the only thing that would have caught it is this file.
 *
 * The CLI half runs anywhere. The seeding half needs the local stack and skips
 * cleanly without it — the same rule the rest of this suite follows, because a
 * suite that reports passed against no database manufactures confidence.
 */
const reachable = await requireDatabase();

describe('the CLI refuses what it cannot honour', () => {
  it('defaults to an MR with no arguments at all', () => {
    const args = parseSeedMrArgs([]);
    expect(args.role).toBe('mr');
    expect(args.email).toBeUndefined();
    expect(args.password).toBeUndefined();
  });

  it('takes an email and password so the address can be typed on a handset', () => {
    const args = parseSeedMrArgs(['--email', 'mr@example.test', '--password', 'hunter2']);
    expect(args.email).toBe('mr@example.test');
    expect(args.password).toBe('hunter2');
  });

  it.each(['mr', 'field_manager', 'admin'])('accepts the %s role', (role) => {
    expect(parseSeedMrArgs(['--role', role]).role).toBe(role);
  });

  it('refuses a role the schema has no value for', () => {
    // `app_role` is an enum. A typo would otherwise reach Postgres as an insert
    // failure halfway through, after the auth user had already been created.
    expect(() => parseSeedMrArgs(['--role', 'manager'])).toThrow(/must be one of/u);
  });

  it('refuses a flag whose value was swallowed by the next flag', () => {
    expect(() => parseSeedMrArgs(['--email', '--password', 'x'])).toThrow(/needs a value/u);
  });

  it('refuses an argument it does not recognise', () => {
    expect(() => parseSeedMrArgs(['--force'])).toThrow(/Unrecognised/u);
  });
});

describe.skipIf(!reachable)('seeding one user end to end', () => {
  const stack = { apiUrl: API_URL, serviceRoleKey: SERVICE_ROLE_KEY };

  it('mints a profile whose credentials actually sign in', async () => {
    // The whole point of the script. A profile row that satisfies every constraint
    // and still cannot sign in is the failure mode worth a test — it sends whoever
    // ran the seed to debug the app instead of the seed.
    const seeded: SeededUser = await seedOneMr(stack);

    expect(seeded.role).toBe('mr');
    expect(seeded.email).toMatch(/@example\.test$/u);

    const token = await verifySignIn(seeded.email, seeded.password, stack);
    expect(token.split('.')).toHaveLength(3);

    await withClient(async (client) => {
      const { rows } = await client.query<{ role: string; territory_id: string | null }>(
        'select role, territory_id from public.user_profiles where id = $1',
        [seeded.userId],
      );
      expect(rows[0]?.role).toBe('mr');
      // `user_profiles_field_roles_require_territory` rejects a field role without
      // one, on the grounds that no scope silently means "sees nothing".
      expect(rows[0]?.territory_id).toBe(seeded.territoryId);
    });
  });

  it('gives an admin no territory, which is the one role allowed none', async () => {
    const seeded: SeededUser = await seedOneMr({ ...stack, role: 'admin' });

    await withClient(async (client) => {
      const { rows } = await client.query<{ territory_id: string | null }>(
        'select territory_id from public.user_profiles where id = $1',
        [seeded.userId],
      );
      expect(rows[0]?.territory_id).toBeNull();
    });
  });

  it('mints a fresh address every run, so a second run does not collide', async () => {
    // Nothing is torn down — `consent_records` and `audit_log` are append-only by
    // trigger — so re-runnability depends on this and not on cleanup.
    const [first, second] = await Promise.all([seedOneMr(stack), seedOneMr(stack)]);
    expect(first.email).not.toBe(second.email);
  });
});
