import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-53 B1 — the screen asks the server whether this visit may be recorded.
 *
 * **The reason this read exists at all:** `sync_pull` deliberately does not carry `consent_record`
 * (MR-21 B6), so the phone cannot know the doctor's answer and `app/visit/[id].tsx` held an empty
 * list. Putting the ledger on the phone would mean re-deriving the consent rule there; asking the
 * server means the rule stays in one place.
 *
 * **The agreement test is the load-bearing one.** A read that says "you may record" where
 * `begin_upload` would refuse is worse than no read: the MR would see a control, press it, and be
 * told no by the server. So the last case here drives BOTH and asserts they answer the same way.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** The flag is OFF as it ships; every consent case needs it on to be about consent at all. */
const withFeatureOn = async (client: Client): Promise<void> => {
  await client.query(
    `insert into public.app_thresholds (key, value, scope, note)
     values ('recording_feature_enabled', 'true'::jsonb, 'global',
             'MR-53 test, inside a rolled-back transaction')`,
  );
};

const permission = async (client: Client, visitId: string) => {
  const { rows } = await client.query<{ answer: Record<string, unknown> }>(
    'select public.recording_permission($1) as answer',
    [visitId],
  );
  return rows[0]?.answer ?? {};
};

const consent = async (
  client: Client,
  visitId: string,
  outcome: 'consented' | 'declined',
): Promise<string> => {
  const id = randomUUID();
  // (id, visit, outcome, language, version, notAskedReason, capturedAt) -- the order the function
  // declares, read from pg_get_function_arguments rather than guessed.
  await client.query("select public.capture_consent($1, $2, $3, 'en-IN', $4, null, now())", [
    id,
    visitId,
    outcome,
    world.consentTextVersionId,
  ]);
  return id;
};

/**
 * A visit of this MR's with NO consent ledger at all.
 *
 * The fixture's Pune visit already carries a standing consent, so "never asked" and "declined"
 * cannot be told there: under this schema a later `declined` row does not revoke an earlier
 * consent -- only a withdrawal does, and `begin_upload` reads it the same way.
 */
const freshVisit = async (client: Client): Promise<string> => {
  const id = randomUUID();
  await client.query('set local role postgres');
  await client.query(
    'insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, $4)',
    [id, world.users.puneMr.id, world.doctors.pune, 'in_progress'],
  );
  await asUser(client, world.users.puneMr);
  return id;
};

describe.skipIf(!reachable)('MR-53 B2 — the flag is off, and off means off', () => {
  it('answers feature_off even when the doctor has agreed', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await consent(client, world.visits.pune, 'consented');
      const answer = await permission(client, world.visits.pune);
      expect(answer['allowed']).toBe(false);
      expect(answer['reason']).toBe('feature_off');
      expect(answer['featureEnabled']).toBe(false);
    });
  });

  it('POSITIVE CONTROL: the same visit is allowed once the flag is on', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const id = await consent(client, world.visits.pune, 'consented');
      await client.query('set local role postgres');
      await withFeatureOn(client);
      await asUser(client, world.users.puneMr);

      const answer = await permission(client, world.visits.pune);
      expect(answer['allowed']).toBe(true);
      expect(answer['reason']).toBe('allowed');
      // The screen is told WHICH consent authorises it, so the recording row can cite that row.
      expect(answer['consentRecordId']).toBe(id);
    });
  });
});

describe.skipIf(!reachable)('MR-53 B3 — which "no" it is', () => {
  const cases: readonly [string, 'never_asked' | 'declined' | 'withdrawn'][] = [
    ['nothing captured at all', 'never_asked'],
    ['the doctor said no', 'declined'],
    ['the doctor agreed and then withdrew', 'withdrawn'],
  ];

  it.each(cases)('%s reads as %s', async (label, expected) => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await client.query('set local role postgres');
      await withFeatureOn(client);
      await asUser(client, world.users.puneMr);

      // never_asked and declined need a visit with no standing consent; withdrawn needs one WITH
      // a consent to withdraw, which the fixture's Pune visit already has.
      const visitId = expected === 'withdrawn' ? world.visits.pune : await freshVisit(client);
      if (expected === 'declined') await consent(client, visitId, 'declined');
      if (expected === 'withdrawn') {
        const given = world.consentRecords.pune;
        // As the owner: `consent_records` has no INSERT grant to a signed-in role -- every write
        // goes through `capture_consent`, and that function has no withdrawal argument. The same
        // shape `consent-audio.spec.ts` uses.
        await client.query('set local role postgres');
        await client.query(
          `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
           -- consent_records_withdrawal_is_declined: a withdrawal row carries declined.
           select $1, c.visit_id, c.doctor_id, c.captured_by_mr_id, 'declined',
                  c.consent_text_version_id, c.displayed_language, c.id, true, now()
             from public.consent_records c where c.id = $2`,
          [randomUUID(), given],
        );
        await asUser(client, world.users.puneMr);
      }

      const answer = await permission(client, visitId);
      expect(answer['allowed'], label).toBe(false);
      expect(answer['reason'], label).toBe(expected);
    });
  });

  it('another rep’s visit is not distinguishable from a visit that does not exist', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const theirs = await permission(client, world.visits.south);
      const nothing = await permission(client, randomUUID());
      expect(theirs['reason']).toBe('not_your_visit');
      expect(nothing['reason']).toBe('not_your_visit');
      expect(theirs).toEqual(nothing);
    });
  });
});

describe.skipIf(!reachable)('MR-53 B1 — the read and the write agree', () => {
  /** Does `begin_upload` accept a recording for this visit? The write's own answer. */
  const writeAllows = async (client: Client, visitId: string): Promise<boolean> => {
    await client.query('savepoint probe');
    try {
      await client.query("select public.begin_upload($1, 'recording', 1024, 30)", [visitId]);
      await client.query('release savepoint probe');
      return true;
    } catch {
      await client.query('rollback to savepoint probe');
      return false;
    }
  };

  it('says yes exactly when begin_upload issues a grant, and no exactly when it refuses', async () => {
    for (const outcome of ['consented', 'declined'] as const) {
      await inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        await client.query('set local role postgres');
        await withFeatureOn(client);
        await asUser(client, world.users.puneMr);
        const visitId = await freshVisit(client);
        await consent(client, visitId, outcome);

        const read = (await permission(client, visitId))['allowed'];
        const write = await writeAllows(client, visitId);
        expect(read, `${outcome}: the read said ${String(read)}`).toBe(write);
        // Content, not container: one of the two runs must actually be an allow, or this passes
        // on two refusals and proves nothing.
        expect(read).toBe(outcome === 'consented');
      });
    }
  });
});
