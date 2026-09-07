import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import type { Client } from 'pg';
import { evaluateDecisionDebt } from '../scripts/check-decision-debt.mjs';

/**
 * BE-W21 — the forcing function on the UCPMP cap decision.
 *
 * `20260907000700_ucpmp_sample_caps.sql` built the cap and left the ceiling null on
 * purpose, because nothing in this repository states what the UCPMP limit is. Correct,
 * and it leaves the trigger inert with nothing making anybody answer the question.
 * `20260907000900` gave the decision a deadline; this is what proves the deadline works.
 *
 * **Nothing here depends on today's date.** A test that fails on 6 November because a
 * calendar rolled over would break `pnpm test` for a developer who owns none of this,
 * and a control that costs somebody their afternoon gets skipped. The deadline is
 * exercised by writing a backdated row, which is the same technique
 * `20260816000200_shift_window_expiry.sql` records for its own expiry: "a backdated row
 * with a backdated expiry is a legitimate correction to the record AND the only honest
 * way to exercise the far side of the boundary".
 *
 * The calendar-sensitive half is `check:decision-debt`, which runs in CI only.
 */

const reachable = await requireDatabase();

/**
 * `app_thresholds` is append-only, so a new value is a later row, never an update.
 *
 * `effective_from` is expressed as seconds BEFORE now rather than as a date, because
 * `threshold()` picks the latest row with `effective_from <= now()` and the migration's
 * own row is stamped whenever the database was last reset. A literal date would either
 * lose to that row or sit in the future and be ignored -- which is how the first draft
 * of this file passed while proving nothing.
 */
const supersede = async (
  client: Client,
  key: string,
  value: string,
  secondsAgo: number,
): Promise<void> => {
  await client.query(
    `insert into public.app_thresholds (key, value, scope, effective_from, note)
     values ($1, $2::jsonb, 'global', now() - make_interval(secs => $3), 'FIX-10 test fixture')`,
    [key, value, secondsAgo],
  );
};

const status = async (client: Client): Promise<Record<string, unknown>> => {
  const result = await client.query<{ s: Record<string, unknown> }>(
    'select public.ucpmp_cap_decision_status() as s',
  );
  const value = result.rows[0]?.s;
  if (value === undefined) throw new Error('ucpmp_cap_decision_status() returned nothing');
  return value;
};

describe.skipIf(!reachable)('the UCPMP cap decision has a deadline that bites', () => {
  it('is outstanding but not yet overdue as the schema ships', async () => {
    // The state on the day this was written: no cap, a deadline in the future. If this
    // ever reads `overdue`, CI is already failing and somebody needs to answer the
    // question rather than change this test.
    await inRolledBackTransaction(async (client) => {
      const s = await status(client);
      expect(s['capConfigured']).toBe(false);
      expect(s['dueAt']).not.toBeNull();
      expect(typeof s['daysRemaining']).toBe('number');
    });
  });

  it('reports overdue once the deadline has passed with no cap set', async () => {
    await inRolledBackTransaction(async (client) => {
      await supersede(client, 'ucpmp_sample_cap_decision_due', '"2026-01-01T00:00:00Z"', 2);
      const s = await status(client);
      expect(s['overdue']).toBe(true);
      expect(s['daysRemaining']).toBe(0);
    });
  });

  it('stops reporting overdue the moment a cap is configured', async () => {
    // The deadline is on the DECISION, not on the calendar. Answering it clears the
    // alarm even after the date has passed, which is the difference between a forcing
    // function and a punishment.
    await inRolledBackTransaction(async (client) => {
      await supersede(client, 'ucpmp_sample_cap_decision_due', '"2026-01-01T00:00:00Z"', 2);
      await supersede(client, 'ucpmp_sample_cap_quantity', '10', 1);
      const s = await status(client);
      expect(s['capConfigured']).toBe(true);
      expect(s['overdue']).toBe(false);
    });
  });

  it('FAILS CLOSED: removing the deadline reads as overdue, not as "no deadline"', async () => {
    // The alarm must not be silenceable by deleting the row that carries it. That is
    // exactly how FIX-05's `ALTER DEFAULT PRIVILEGES` came to look like a control while
    // enforcing nothing, and it is the failure mode this assertion exists to block.
    await inRolledBackTransaction(async (client) => {
      await supersede(client, 'ucpmp_sample_cap_decision_due', 'null', 2);
      const s = await status(client);
      expect(s['dueAt']).toBeNull();
      expect(s['overdue']).toBe(true);
    });
  });

  it('a deferral is a later row, and it moves the deadline rather than removing it', async () => {
    await inRolledBackTransaction(async (client) => {
      await supersede(client, 'ucpmp_sample_cap_decision_due', '"2026-01-01T00:00:00Z"', 2);
      expect((await status(client))['overdue']).toBe(true);

      await supersede(client, 'ucpmp_sample_cap_decision_due', '"2099-01-01T00:00:00Z"', 1);
      const s = await status(client);
      expect(s['overdue']).toBe(false);
      expect(s['capConfigured']).toBe(false);
    });
  });

  it('warns for the 21 days before the deadline, without going overdue', async () => {
    // The point of the window: a red build arriving unannounced is treated as an
    // obstacle to get past, a warning three weeks earlier as a question. Ten days out
    // is inside the window and not yet overdue.
    await inRolledBackTransaction(async (client) => {
      await supersede(
        client,
        'ucpmp_sample_cap_decision_due',
        JSON.stringify(new Date(Date.now() + 10 * 86_400_000).toISOString()),
        2,
      );
      const s = await status(client);
      expect(s['warn']).toBe(true);
      expect(s['overdue']).toBe(false);
      expect(s['warnDays']).toBe(21);
    });
  });

  it('does not warn while the deadline is further out than the window', async () => {
    // Without this the previous test would pass against a function that warns always,
    // which is a warning nobody reads.
    await inRolledBackTransaction(async (client) => {
      await supersede(
        client,
        'ucpmp_sample_cap_decision_due',
        JSON.stringify(new Date(Date.now() + 40 * 86_400_000).toISOString()),
        2,
      );
      const s = await status(client);
      expect(s['warn']).toBe(false);
      expect(s['overdue']).toBe(false);
    });
  });

  it('stops warning once it is overdue, rather than warning and failing at once', async () => {
    // Mutually exclusive on purpose. A caller that treats `warn` as "not yet serious"
    // must never still see it on the day the build goes red, or it reads the red as a
    // warning too.
    await inRolledBackTransaction(async (client) => {
      await supersede(client, 'ucpmp_sample_cap_decision_due', '"2026-01-01T00:00:00Z"', 2);
      const s = await status(client);
      expect(s['overdue']).toBe(true);
      expect(s['warn']).toBe(false);
    });
  });

  it('does not warn once the cap is configured', async () => {
    await inRolledBackTransaction(async (client) => {
      await supersede(
        client,
        'ucpmp_sample_cap_decision_due',
        JSON.stringify(new Date(Date.now() + 10 * 86_400_000).toISOString()),
        2,
      );
      await supersede(client, 'ucpmp_sample_cap_quantity', '10', 1);
      const s = await status(client);
      expect(s['warn']).toBe(false);
      expect(s['warnFromAt']).toBeNull();
    });
  });

  it('the threshold row cannot be quietly edited or deleted', async () => {
    // `app_thresholds` carries a statement-level reject_mutation trigger, which is what
    // makes "a deferral is on the record" true rather than aspirational.
    await inRolledBackTransaction(async (client) => {
      await expect(
        client.query(
          `delete from public.app_thresholds where key = 'ucpmp_sample_cap_decision_due'`,
        ),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });
});

describe('check:decision-debt turns that status into a CI failure', () => {
  // Pure, so the overdue path is testable without waiting for November and without a
  // database. These run even when the stack is down.
  it('is clear when the decision is not overdue', () => {
    expect(
      evaluateDecisionDebt({ capConfigured: false, overdue: false, daysRemaining: 60 }),
    ).toEqual({ clear: true, reasons: [], warnings: [] });
  });

  it('fails, with the date, when the decision is overdue', () => {
    const result = evaluateDecisionDebt({
      capConfigured: false,
      overdue: true,
      dueAt: '2026-11-06T00:00:00Z',
    });
    expect(result.clear).toBe(false);
    expect(result.reasons.join(' ')).toContain('2026-11-06');
  });

  it('warns without failing inside the window', () => {
    const result = evaluateDecisionDebt({
      capConfigured: false,
      overdue: false,
      warn: true,
      dueAt: '2026-11-06T00:00:00Z',
      daysRemaining: 10,
    });
    // The distinction the whole window rests on: something is said, nothing is failed.
    expect(result.clear).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('2026-11-06');
  });

  it('says nothing at all while the deadline is outside the window', () => {
    const result = evaluateDecisionDebt({
      capConfigured: false,
      overdue: false,
      warn: false,
      dueAt: '2026-11-06T00:00:00Z',
      daysRemaining: 60,
    });
    expect(result).toEqual({ clear: true, reasons: [], warnings: [] });
  });

  it('fails closed on a status it cannot read', () => {
    // A control that treats an unreadable answer as "fine" is not a control. If the
    // rollback in 20260907000900 is ever applied, the function disappears, this returns
    // null, and CI goes red rather than green.
    expect(evaluateDecisionDebt(null).clear).toBe(false);
    expect(evaluateDecisionDebt({ capConfigured: false }).clear).toBe(false);
  });
});
