import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateSettingsModelDebt } from '../scripts/check-decision-debt.mjs';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser, rest, signIn } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-52 D — `BE-W106`'s leak is closed without answering `BE-W106`.
 *
 * MR-51 C1 measured it: `app_thresholds` was the one table of nineteen that a signed-in user could
 * read across the tenant boundary — the key, the value, another company's territory id, and
 * `set_by_user_id`, one of their users. The direct read is gone. What remains open is the MODEL
 * question, and D4 gives that acceptance a date instead of an open end.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;
const tokens = new Map<string, string>();

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const token = async (user: FixtureUser): Promise<string> => {
  const cached = tokens.get(user.id);
  if (cached !== undefined) return cached;
  const { accessToken } = await signIn(user.email, user.password);
  tokens.set(user.id, accessToken);
  return accessToken;
};

describe.skipIf(!reachable)('D3 — the settings table is not readable by a signed-in user', () => {
  it('an MR reading it over HTTP is refused, whosever row it is', async () => {
    const response = await rest('/app_thresholds?select=*', {
      token: await token(world.users.puneMr),
    });
    // Refused, not filtered: an empty list would be a boundary this test could not tell from a
    // table that happens to be empty. 403 is what a SIGNED-IN caller gets for a missing grant;
    // 401 is what the publishable key alone gets, and the two are different facts.
    expect(response.status, response.text).toBe(403);
    expect(response.body).toMatchObject({ code: '42501' });
    expect(response.text).toContain('permission denied');
  });

  it('an admin is refused the same way — this is a grant, not a role rule', async () => {
    const response = await rest('/app_thresholds?select=*', {
      token: await token(world.users.admin),
    });
    expect(response.status, response.text).toBe(403);
  });

  it('and neither can reach another company’s user id through it', async () => {
    const response = await rest('/app_thresholds?select=set_by_user_id,territory_id', {
      token: await token(world.users.rivalAdmin),
    });
    expect(response.status).toBe(403);
    expect(response.text).not.toContain(world.users.admin.id);
  });

  it('POSITIVE CONTROL: the values still reach the app, through the function that serves them', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const { rows } = await client.query<{ value: unknown }>(
        "select public.threshold('be_w106_settings_model_decision_due') as value",
      );
      // The app never reads the table; every value arrives through a SECURITY DEFINER function,
      // and revoking the table's grant does not touch that path.
      expect(rows[0]?.value).not.toBeNull();
    });
  });

  it('POSITIVE CONTROL: an MR’s own shift window still resolves', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const { rows } = await client.query<{ window: unknown }>(
        'select public.my_shift_window() as window',
      );
      expect(rows[0]?.window).not.toBeNull();
    });
  });
});

describe.skipIf(!reachable)('D4 — the acceptance is DISCHARGED: `BE-W106` is answered', () => {
  /**
   * W1-L Part C changed what this block can assert, and the change is the point.
   *
   * These three tests used to assert the debt was OUTSTANDING, and one of them simulated the
   * answer by adding an `organisation_id` column inside a rolled-back transaction. The column
   * now exists for real, so that test failed with `column "organisation_id" already exists` —
   * **the gate detected its own answer without anybody remembering to update a flag**, which is
   * exactly what D4 was built to do.
   *
   * What can no longer be asserted against the live database is `overdue`, because the schema
   * fact that clears it is now permanently true. That claim moves to the pure half, which still
   * owns the logic and can still be given any input.
   */
  it('reads as answered from the live schema, not from a flag anybody sets', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ status: Record<string, unknown> }>(
        'select public.be_w106_decision_status() as status',
      );
      const status = rows[0]?.status ?? {};
      expect(status['settingsScoped']).toBe(true);
      expect(status['overdue']).toBe(false);
      expect(status['warn']).toBe(false);
      expect(evaluateSettingsModelDebt(status).clear).toBe(true);
    });
  });

  it('stays answered even with the deadline backdated — the date no longer decides', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `insert into public.app_thresholds (key, value, scope, note)
         values ('be_w106_settings_model_decision_due', '"2026-09-01T00:00:00Z"'::jsonb, 'global',
                 'backdated inside a rolled-back transaction')`,
      );
      // Before Part C this produced `overdue: true`. A deadline is only a deadline while the
      // thing it is waiting for has not happened.
      const { rows } = await client.query<{ status: Record<string, unknown> }>(
        'select public.be_w106_decision_status() as status',
      );
      expect(rows[0]?.status['settingsScoped']).toBe(true);
      expect(rows[0]?.status['overdue']).toBe(false);
    });
  });

  it('STILL FAILS the debt when nothing is scoped — the gate did not lose its teeth', () => {
    // The pure half, given the input the database can no longer produce. Without this the suite
    // would only ever see the passing state, and a broken gate would look identical to a clear one.
    const verdict = evaluateSettingsModelDebt({
      settingsScoped: false,
      dueAt: '2026-09-01T00:00:00+00:00',
      overdue: true,
    });
    expect(verdict.clear).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('BE-W106');
  });

  it('FAILS CLOSED: with no deadline row readable, it reads as overdue', () => {
    // The pure half, so the fail-closed rule is testable without deleting an append-only row.
    const verdict = evaluateSettingsModelDebt({
      settingsScoped: false,
      dueAt: null,
      overdue: true,
    });
    expect(verdict.clear).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('never set');
  });

  it('warns before it fails, and says how long is left', () => {
    const verdict = evaluateSettingsModelDebt({
      settingsScoped: false,
      dueAt: '2026-10-31T00:00:00+00:00',
      overdue: false,
      warn: true,
      daysRemaining: 9,
    });
    expect(verdict.clear).toBe(true);
    expect(verdict.warnings.join(' ')).toContain('9 day(s) left');
  });

  it('an unreadable answer is a failure, not a pass', () => {
    expect(evaluateSettingsModelDebt(null).clear).toBe(false);
  });
});
