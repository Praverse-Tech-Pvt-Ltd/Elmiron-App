import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-53 B4 — a withdrawal during a recording, and what the existing cascade does about it.
 *
 * **Nothing here is new machinery.** `cascade_consent_withdrawal` has revoked grants and destroyed
 * downstream audio since MR-14; what has never existed is a caller that could be mid-recording when
 * it fires. These cases pin the behaviour the client now depends on: the grant dies, the next byte
 * is refused with a consent reason rather than a state reason, and the screen's own read flips to
 * `withdrawn` so the MR is told which it was.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const withdraw = async (client: Client, consentId: string): Promise<void> => {
  await client.query('set local role postgres');
  await client.query(
    `insert into public.consent_records
       (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
        displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
     select $1, c.visit_id, c.doctor_id, c.captured_by_mr_id, 'declined',
            c.consent_text_version_id, c.displayed_language, c.id, true, now()
       from public.consent_records c where c.id = $2`,
    [randomUUID(), consentId],
  );
  await asUser(client, world.users.puneMr);
};

const grantFor = async (client: Client, visitId: string) => {
  const { rows } = await client.query<{ id: string; state: string }>(
    "select (public.begin_upload($1, 'recording', 4096, 60)).*",
    [visitId],
  );
  return rows[0];
};

describe.skipIf(!reachable)('MR-53 B4 — a withdrawal mid-recording wins', () => {
  it('revokes the open grant, so no further byte is accepted', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const grant = await grantFor(client, world.visits.pune);
      expect(grant?.state).toBe('open');

      await withdraw(client, world.consentRecords.pune);

      const { rows } = await client.query<{ state: string; closed_reason: string | null }>(
        'select state, closed_reason from public.upload_grants where id = $1',
        [grant?.id],
      );
      expect(rows[0]?.state).toBe('revoked');
    });
  });

  it('refuses the next byte for the CONSENT reason, not for the grant’s state', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const grant = await grantFor(client, world.visits.pune);
      await withdraw(client, world.consentRecords.pune);

      // The order matters and is recorded in the function: a state-first refusal would tell the MR
      // "this grant is revoked", which reads as a system fault they caused, and maps to
      // `validation_failed` — "the server refused the contents of this item" — when in fact the
      // doctor changed their mind.
      // As the owner: this helper is internal -- `begin_upload` and `complete_upload` call it, and
      // it carries no grant to a signed-in role. Calling it directly is how the test reaches the
      // rule without inventing a second path to it.
      await client.query('set local role postgres');
      const refusal = await client
        .query(
          'select public.assert_upload_still_permitted(g.*) from public.upload_grants g where g.id = $1',
          [grant?.id],
        )
        .catch((error: unknown) => error as { code?: string; message?: string });

      expect((refusal as { code?: string }).code).toBe('42501');
      expect((refusal as { message?: string }).message).toMatch(/consent has been withdrawn/u);
    });
  });

  it('and the screen’s own read flips to withdrawn, so the MR is told which it was', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await client.query('set local role postgres');
      await client.query(
        `insert into public.app_thresholds (key, value, scope, note)
         values ('recording_feature_enabled', 'true'::jsonb, 'global', 'MR-53 B4 test')`,
      );
      await asUser(client, world.users.puneMr);

      const before = await client.query<{ answer: Record<string, unknown> }>(
        'select public.recording_permission($1) as answer',
        [world.visits.pune],
      );
      expect(before.rows[0]?.answer['allowed'], 'positive control').toBe(true);

      await withdraw(client, world.consentRecords.pune);

      const after = await client.query<{ answer: Record<string, unknown> }>(
        'select public.recording_permission($1) as answer',
        [world.visits.pune],
      );
      expect(after.rows[0]?.answer['allowed']).toBe(false);
      expect(after.rows[0]?.answer['reason']).toBe('withdrawn');
    });
  });

  it('POSITIVE CONTROL: with no withdrawal the grant stays open and accepts bytes', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const grant = await grantFor(client, world.visits.pune);

      await client.query('set local role postgres');
      await client.query(
        'select public.assert_upload_still_permitted(g.*) from public.upload_grants g where g.id = $1',
        [grant?.id],
      );
      const { rows } = await client.query<{ state: string }>(
        'select state from public.upload_grants where id = $1',
        [grant?.id],
      );
      expect(rows[0]?.state).toBe('open');
    });
  });
});
