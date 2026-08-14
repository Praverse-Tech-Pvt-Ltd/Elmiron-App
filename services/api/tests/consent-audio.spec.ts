import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { DB_URL, inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { API_URL, SERVICE_ROLE_KEY, asUser, mintAccessToken } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
// The worker is plain JS with a sibling .d.mts, so the suite drives the real thing
// rather than a reimplementation of it, and still typechecks.
import { runPurge } from '../scripts/purge-expired-audio.mjs';

/**
 * BE-W6 — consent, audio storage, withdrawal and retention.
 *
 * Three properties, and each test below exists to make one of them impossible to
 * hold wrong:
 *
 *   1. No audio without a standing `consented` record.
 *   2. Withdrawal destroys, it does not hide.
 *   3. Nothing survives 90 days, counted from the server's receipt.
 *
 * No PHI anywhere. The synthetic audio is 32 bytes of zeroes and the synthetic
 * transcripts say nothing about anybody.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

/** Synthetic. Thirty-two zero bytes is not audio and contains nothing. */
const SYNTHETIC_AUDIO = new Uint8Array(32);

const SYNTHETIC_TRANSCRIPT = {
  schemaVersion: 'v0',
  vendor: 'fixture',
  modelVersion: 'v0',
  primaryLanguage: 'en-IN',
  durationMs: 1000,
  transcribedAt: '2026-08-15T10:00:00+05:30',
  segments: [
    {
      id: '20202020-2020-4020-8020-202020202001',
      speakerLabel: 'speaker_0',
      startMs: 0,
      endMs: 1000,
      text: 'synthetic transcript segment',
      language: 'en-IN',
    },
  ],
};

const storageObjectExists = async (storageKey: string): Promise<boolean> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return response.ok;
};

const uploadObject = async (storageKey: string): Promise<void> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'audio/ogg',
    },
    body: SYNTHETIC_AUDIO,
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${String(response.status)} ${await response.text()}`);
  }
};

const opaqueKey = (): string => `recordings/${randomUUID()}/${randomUUID()}.opus`;

/** A committed visit with a standing consent, for the paths that cross HTTP. */
const committedConsentedVisit = async (): Promise<{
  visitId: string;
  consentId: string;
}> =>
  withClient(async (client) => {
    const visitId = randomUUID();
    const consentId = randomUUID();
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
      [visitId, world.users.puneMr.id, world.doctors.pune],
    );
    await client.query(
      `insert into public.consent_records
         (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
          displayed_language, captured_at)
       values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
      [consentId, visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId],
    );
    return { visitId, consentId };
  });

// =============================================================================
// 1. Consent capture
// =============================================================================

describe.skipIf(!reachable)('consent capture', () => {
  it.each(['consented', 'declined', 'not_asked'] as const)(
    'records %s as a complete, successful capture',
    async (outcome) => {
      await asUserTx(world.users.puneMr, async (client) => {
        // Both halves in ONE statement, so they share one snapshot.
        //
        // Every fixture run seeds its own `en-IN` consent text with effective_from
        // now(), so all runs compete to be the active version. Read across two
        // statements under READ COMMITTED, another spec file committing its fixture
        // between them changes the answer, and this fails claiming capture_consent
        // stamped the wrong version. Flaky roughly one run in ten with the BE-W7
        // suite at ten spec files; rarer, but present, before that.
        //
        // The property being tested is unchanged: the version comes from the
        // server's catalogue rather than from the caller. The stronger guard is the
        // structural test below — capture_consent has no version parameter at all.
        const result = await client.query<{
          outcome: string;
          consent_text_version_id: string;
          active_id: string;
        }>(
          `select c.outcome,
                  c.consent_text_version_id,
                  (select a.id from public.active_consent_text('en-IN') a) as active_id
             from public.capture_consent($1, $2, $3, $4, $5) c`,
          [
            randomUUID(),
            world.visits.pune,
            outcome,
            'en-IN',
            outcome === 'not_asked' ? 'Doctor was called away.' : null,
          ],
        );
        expect(result.rows[0]?.outcome).toBe(outcome);
        // Whatever the server's catalogue says is active — not a version the test
        // or the client chose.
        expect(result.rows[0]?.consent_text_version_id).toBe(result.rows[0]?.active_id);
      });
    },
  );

  it('takes the text version from the server catalogue, not from the client', async () => {
    // capture_consent has no parameter for the version at all. A client that
    // reports it displayed v4 when v5 is current is either stale or lying, and
    // there is no way to tell which — so the question is never asked.
    await inRolledBackTransaction(async (client) => {
      const args = await client.query<{ parameters: string }>(
        `select pg_get_function_arguments(p.oid) as parameters
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'capture_consent'`,
      );
      expect(args.rows[0]?.parameters).not.toMatch(/version/i);
    });
  });

  it('refuses a language with no active consent text', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.capture_consent($1, $2, $3, $4)', [
          randomUUID(),
          world.visits.pune,
          'consented',
          'xx-XX',
        ]),
      ),
    ).rejects.toThrow(/no active consent text/);
  });

  it('is idempotent on the client-generated id', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      await client.query('select public.capture_consent($1, $2, $3, $4)', [
        id,
        world.visits.pune,
        'declined',
        'en-IN',
      ]);
      const replay = await client.query<{ outcome: string }>(
        'select outcome from public.capture_consent($1, $2, $3, $4)',
        [id, world.visits.pune, 'consented', 'en-IN'],
      );
      // The replay does not overwrite the original with a different outcome.
      expect(replay.rows[0]?.outcome).toBe('declined');
    });
  });
});

// =============================================================================
// 2. No audio without consent — absent, not disabled
// =============================================================================

describe.skipIf(!reachable)('the recording path is absent without consent', () => {
  const visitWithOutcome = async (
    client: Client,
    outcome: 'declined' | 'not_asked' | null,
  ): Promise<string> => {
    const visitId = randomUUID();
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
      [visitId, world.users.puneMr.id, world.doctors.pune],
    );
    if (outcome !== null) {
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, not_asked_reason,
            consent_text_version_id, displayed_language, captured_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'en-IN', now())`,
        [
          visitId,
          world.doctors.pune,
          world.users.puneMr.id,
          outcome,
          outcome === 'not_asked' ? 'called away' : null,
          world.consentTextVersionId,
        ],
      );
    }
    return visitId;
  };

  it.each(['declined', 'not_asked', null] as const)(
    'issues no upload grant at all when the outcome is %s',
    async (outcome) => {
      await expect(
        inRolledBackTransaction(async (client) => {
          const visitId = await visitWithOutcome(client, outcome);
          await asUser(client, world.users.puneMr);
          return client.query('select public.issue_recording_upload_grant($1, $2, $3)', [
            visitId,
            1024,
            60,
          ]);
        }),
      ).rejects.toThrow(/no standing consent; there is no upload path/);
    },
  );

  it('issues a grant with an opaque, server-generated key when consent stands', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const result = await client.query<{ storage_key: string; expires_at: string }>(
        'select storage_key, expires_at from public.issue_recording_upload_grant($1, $2, $3)',
        [world.visits.pune, 1024, 60],
      );
      const key = result.rows[0]?.storage_key ?? '';
      expect(key).toMatch(/^recordings\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.opus$/);
      // Nothing about a doctor, a clinic or a patient. Object paths leak through
      // logs, error messages and support tickets.
      expect(key).not.toMatch(/pune|kulkarni|dr|clinic/i);
      expect(new Date(result.rows[0]?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('refuses an unbounded upload', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.issue_recording_upload_grant($1, $2, $3)', [
          world.visits.pune,
          Number.MAX_SAFE_INTEGER,
          60,
        ]),
      ),
    ).rejects.toThrow(/size must be between/);

    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.issue_recording_upload_grant($1, $2, $3)', [
          world.visits.pune,
          1024,
          60 * 60 * 24,
        ]),
      ),
    ).rejects.toThrow(/duration must be between/);
  });

  it('refuses a recordings row whose consent is not `consented`', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const visitId = await visitWithOutcome(client, 'declined');
        const consent = await client.query<{ id: string }>(
          'select id from public.consent_records where visit_id = $1',
          [visitId],
        );
        return client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, bitrate_kbps, duration_seconds,
              size_bytes, recorded_at)
           values (gen_random_uuid(), $1, $2, $3, 28, 60, 1024, now())`,
          [visitId, world.users.puneMr.id, consent.rows[0]?.id],
        );
      }),
    ).rejects.toThrow(/audio requires an explicit consent/);
  });

  it('refuses a recordings row with no consent reference at all', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const visitId = await visitWithOutcome(client, null);
        return client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, bitrate_kbps, duration_seconds,
              size_bytes, recorded_at)
           values (gen_random_uuid(), $1, $2, null, 28, 60, 1024, now())`,
          [visitId, world.users.puneMr.id],
        );
      }),
    ).rejects.toThrow(/consent record <NULL> does not exist|null value in column|not-null/i);
  });

  it('refuses an object path that is not opaque', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const consent = await client.query<{ id: string }>(
          `select id from public.consent_records where visit_id = $1 and outcome = 'consented'`,
          [world.visits.pune],
        );
        return client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
              duration_seconds, size_bytes, recorded_at)
           values (gen_random_uuid(), $1, $2, $3, 'recordings/dr-kulkarni/pune-clinic.opus',
                   28, 60, 1024, now())`,
          [world.visits.pune, world.users.puneMr.id, consent.rows[0]?.id],
        );
      }),
    ).rejects.toThrow(/storage_key_check|violates check constraint/);
  });
});

// =============================================================================
// 3. Storage policy — the second consent check
// =============================================================================

describe.skipIf(!reachable)('the storage policy is the control', () => {
  it('refuses an object with no live grant, over real HTTP', async () => {
    const token = mintAccessToken(world.users.puneMr);
    const response = await fetch(`${API_URL}/storage/v1/object/audio/${opaqueKey()}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'audio/ogg',
      },
      body: SYNTHETIC_AUDIO,
    });
    // No grant, no object — regardless of what any application code believes.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('accepts an object that a live grant covers', async () => {
    const { visitId } = await committedConsentedVisit();
    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const result = await client.query<{ storage_key: string }>(
        'select storage_key from public.issue_recording_upload_grant($1, $2, $3)',
        [visitId, 1024, 60],
      );
      await client.query('commit');
      return result.rows[0]?.storage_key ?? '';
    });

    const token = mintAccessToken(world.users.puneMr);
    const response = await fetch(`${API_URL}/storage/v1/object/audio/${grant}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'audio/ogg',
      },
      body: SYNTHETIC_AUDIO,
    });
    expect(response.ok).toBe(true);
  });

  it('keeps the bucket private', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ public: boolean }>(
        `select public from storage.buckets where id = 'audio'`,
      );
      expect(result.rows[0]?.public).toBe(false);
    });
  });
});

// =============================================================================
// 4. The redaction gate — no grant, not a policy
// =============================================================================

describe.skipIf(!reachable)('the LLM gateway cannot reach a raw transcript', () => {
  it('is permission denied, not an empty result', async () => {
    // This is the case where the Gate 0 amendment's distinction genuinely bites.
    // Here the ABSENCE OF A GRANT is the control, so an empty result would mean the
    // control is missing and something else happened to filter the rows.
    await expect(
      inRolledBackTransaction(async (client) => {
        await client.query('set local role llm_gateway');
        return client.query('select id from public.transcripts_raw');
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('can read the redacted table', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('set local role llm_gateway');
      const result = await client.query('select id from public.transcripts_redacted');
      expect(result.rows).toEqual([]);
    });
  });

  it('holds no privilege of any kind on the raw table', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where grantee = 'llm_gateway'
            and table_schema = 'public'
            and table_name in ('transcripts_raw', 'recordings', 'voice_notes', 'consent_records')`,
      );
      expect(result.rows).toEqual([]);
    });
  });

  it('keeps raw and redacted in separate tables', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public'
            and table_name in ('transcripts_raw', 'transcripts_redacted')`,
      );
      expect(result.rows).toHaveLength(2);
    });
  });
});

// =============================================================================
// 5. The withdrawal cascade
// =============================================================================

describe.skipIf(!reachable)('withdrawal destroys, it does not hide', () => {
  const visitWithFullPipeline = async (
    client: Client,
  ): Promise<{ visitId: string; consentId: string; recordingId: string }> => {
    const visitId = randomUUID();
    const consentId = randomUUID();
    const recordingId = randomUUID();
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
      [visitId, world.users.puneMr.id, world.doctors.pune],
    );
    await client.query(
      `insert into public.consent_records
         (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
          displayed_language, captured_at)
       values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
      [consentId, visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId],
    );
    await client.query(
      `insert into public.recordings
         (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
          duration_seconds, size_bytes, recorded_at, upload_status)
       values ($1, $2, $3, $4, $5, 28, 600, 2048, now(), 'uploaded')`,
      [recordingId, visitId, world.users.puneMr.id, consentId, opaqueKey()],
    );
    const raw = await client.query<{ id: string }>(
      `insert into public.transcripts_raw (visit_id, recording_id, language, vendor, model_version, segments)
       values ($1, $2, 'en-IN', 'fixture', 'v0', $3) returning id`,
      [visitId, recordingId, JSON.stringify(SYNTHETIC_TRANSCRIPT)],
    );
    await client.query(
      `insert into public.transcripts_redacted
         (raw_transcript_id, visit_id, language, redaction_engine_version, segments)
       values ($1, $2, 'en-IN', 'v0', $3)`,
      [raw.rows[0]?.id, visitId, JSON.stringify(SYNTHETIC_TRANSCRIPT)],
    );
    await client.query(
      `insert into public.analyses (visit_id, mr_id, status, rubric_version, model_provider, model_version)
       values ($1, $2, 'completed', 'v0', 'fixture', 'v0')`,
      [visitId, world.users.puneMr.id],
    );
    return { visitId, consentId, recordingId };
  };

  const withdraw = async (client: Client, visitId: string, consentId: string): Promise<void> => {
    await client.query(
      `insert into public.consent_records
         (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
          displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
       values (gen_random_uuid(), $1, $2, $3, 'declined', $4, 'en-IN', $5, true, now())`,
      [visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId, consentId],
    );
  };

  it('destroys every derived artifact, not just the audio', async () => {
    await inRolledBackTransaction(async (client) => {
      const { visitId, consentId } = await visitWithFullPipeline(client);
      await withdraw(client, visitId, consentId);

      for (const table of ['transcripts_raw', 'transcripts_redacted', 'analyses']) {
        const remaining = await client.query<{ count: string }>(
          `select count(*) as count from public.${table} where visit_id = $1`,
          [visitId],
        );
        expect(Number(remaining.rows[0]?.count), `${table} should be empty`).toBe(0);
      }
    });
  });

  it('marks the audio object for destruction immediately', async () => {
    await inRolledBackTransaction(async (client) => {
      const { visitId, consentId, recordingId } = await visitWithFullPipeline(client);
      await withdraw(client, visitId, consentId);

      const row = await client.query<{
        purge_state: string;
        destruction_reason: string;
        purge_after: string;
      }>(
        'select purge_state, destruction_reason, purge_after from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('claimed');
      expect(row.rows[0]?.destruction_reason).toBe('withdrawal');
      // Due now, not in ninety days.
      expect(new Date(row.rows[0]?.purge_after ?? 0).getTime()).toBeLessThanOrEqual(
        Date.now() + 1000,
      );
    });
  });

  it('records what was destroyed, and never what it contained', async () => {
    await inRolledBackTransaction(async (client) => {
      const { visitId, consentId, recordingId } = await visitWithFullPipeline(client);
      await withdraw(client, visitId, consentId);

      const log = await client.query<{
        reason: string;
        storage_key_hash: string;
        derived_rows_destroyed: Record<string, number>;
      }>(
        'select reason, storage_key_hash, derived_rows_destroyed from public.audio_destruction_log where object_id = $1',
        [recordingId],
      );
      expect(log.rows[0]?.reason).toBe('withdrawal');
      expect(log.rows[0]?.derived_rows_destroyed).toEqual({
        transcriptsRaw: 1,
        transcriptsRedacted: 1,
        analyses: 1,
      });
      // The audit trail must not become the copy that survives the deletion: the
      // key is hashed, and no content column exists at all.
      expect(log.rows[0]?.storage_key_hash).toMatch(/^[0-9a-f]{64}$/);
      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'audio_destruction_log'`,
      );
      const names = columns.rows.map((r) => r.column_name);
      for (const forbidden of ['segments', 'text', 'transcript', 'content', 'storage_key']) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  it('shows the manager a withdrawn placeholder rather than nothing', async () => {
    // A manager may already have read the summary and cannot un-read it. Silently
    // vanishing is worse than a placeholder: it hides the withdrawal from the only
    // person who might otherwise notice a pattern of them.
    await inRolledBackTransaction(async (client) => {
      const { visitId, consentId } = await visitWithFullPipeline(client);
      await withdraw(client, visitId, consentId);

      await asUser(client, world.users.westManager);
      const status = await client.query<{ recording_status: string; withdrawn_at: string | null }>(
        'select recording_status, withdrawn_at from public.visit_recording_status where visit_id = $1',
        [visitId],
      );
      expect(status.rows[0]?.recording_status).toBe('withdrawn');
      expect(status.rows[0]?.withdrawn_at).not.toBeNull();
    });
  });

  it('handles a withdrawal that arrives after the analysis has already run', async () => {
    // The normal case, not the edge case: withdrawal arrives offline, days late.
    await inRolledBackTransaction(async (client) => {
      const { visitId, consentId } = await visitWithFullPipeline(client);
      await client.query(
        `update public.analyses set generated_at = now() - interval '3 days',
                                    mr_viewed_at = now() - interval '2 days'
          where visit_id = $1`,
        [visitId],
      );
      await withdraw(client, visitId, consentId);

      const analyses = await client.query<{ count: string }>(
        'select count(*) as count from public.analyses where visit_id = $1',
        [visitId],
      );
      expect(Number(analyses.rows[0]?.count)).toBe(0);
    });
  });

  it('refuses a new recording after the consent has been withdrawn', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const { visitId, consentId } = await visitWithFullPipeline(client);
        await withdraw(client, visitId, consentId);
        return client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
              duration_seconds, size_bytes, recorded_at)
           values (gen_random_uuid(), $1, $2, $3, $4, 28, 60, 1024, now())`,
          [visitId, world.users.puneMr.id, consentId, opaqueKey()],
        );
      }),
    ).rejects.toThrow(/has been withdrawn/);
  });

  it('issues no upload grant after a withdrawal', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const { visitId, consentId } = await visitWithFullPipeline(client);
        await withdraw(client, visitId, consentId);
        await asUser(client, world.users.puneMr);
        return client.query('select public.issue_recording_upload_grant($1, $2, $3)', [
          visitId,
          1024,
          60,
        ]);
      }),
    ).rejects.toThrow(/no standing consent/);
  });
});

// =============================================================================
// 6. Retention — the real job, against a real object
// =============================================================================

describe.skipIf(!reachable)('the 90-day purge', () => {
  /** Committed, with a real object in storage and a backdated receipt. */
  const expiredRecording = async (): Promise<{ recordingId: string; storageKey: string }> => {
    const { visitId, consentId } = await committedConsentedVisit();
    const storageKey = opaqueKey();
    await uploadObject(storageKey);

    return withClient(async (client) => {
      const recordingId = randomUUID();
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, upload_status)
         values ($1, $2, $3, $4, $5, 28, 600, 32, now(), 'uploaded')`,
        [recordingId, visitId, world.users.puneMr.id, consentId, storageKey],
      );
      // Backdate the SERVER receipt, which is what the clock is counted from.
      // purge_after only needs to be in the past to be claim-eligible. BE-W8
      // tightened audio_purge_is_stalled()'s window from 48h to 3h (Part 3.1); a
      // 1-day-overdue committed row sat safely under the old bar but trips the new
      // one for the whole shared test database while this row exists uncommitted-
      // to-destroyed, which is a genuine cross-file hazard on a suite that shares
      // one database across parallel workers. 5 minutes overdue is still overdue.
      await client.query(
        `update public.recordings
            set received_at = now() - interval '91 days',
                purge_after = now() - interval '5 minutes'
          where id = $1`,
        [recordingId],
      );
      return { recordingId, storageKey };
    });
  };

  it('destroys the storage object as well as the row', async () => {
    const { recordingId, storageKey } = await expiredRecording();
    expect(await storageObjectExists(storageKey)).toBe(true);

    const result = await runPurge({ dbUrl: DB_URL });
    expect(result.failed).toBe(0);

    // The assertion that matters. A test that only checks the row proves the half
    // that was never in doubt: a row delete does not touch the object.
    expect(await storageObjectExists(storageKey)).toBe(false);

    await withClient(async (client) => {
      const row = await client.query<{ purge_state: string; storage_key: string | null }>(
        'select purge_state, storage_key from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('destroyed');
      expect(row.rows[0]?.storage_key).toBeNull();
    });
  });

  it('counts from the server receipt, never from the client clock', async () => {
    const { visitId, consentId } = await committedConsentedVisit();
    const recordingId = await withClient(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, received_at, purge_after)
         values ($1, $2, $3, $4, $5, 28, 600, 32,
                 now() - interval '200 days',      -- the device says it is ancient
                 now() - interval '200 days',      -- and tries to say the server agrees
                 now() - interval '110 days')`,
        [id, visitId, world.users.puneMr.id, consentId, opaqueKey()],
      );
      const row = await client.query<{ received_at: string; purge_after: string }>(
        'select received_at, purge_after from public.recordings where id = $1',
        [id],
      );
      // The trigger overwrote both. A device cannot start or shorten a compliance
      // clock by lying about when something happened.
      expect(Date.now() - new Date(row.rows[0]?.received_at ?? 0).getTime()).toBeLessThan(60_000);
      const purgeAfter = new Date(row.rows[0]?.purge_after ?? 0).getTime();
      expect(purgeAfter).toBeGreaterThan(Date.now() + 89 * 24 * 3600 * 1000);
      return id;
    });

    const result = await runPurge({ dbUrl: DB_URL });
    await withClient(async (client) => {
      const row = await client.query<{ purge_state: string }>(
        'select purge_state from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('live');
    });
    expect(result.failed).toBe(0);
  });

  it('is safe to run twice', async () => {
    const { recordingId, storageKey } = await expiredRecording();
    await runPurge({ dbUrl: DB_URL });
    const second = await runPurge({ dbUrl: DB_URL });

    expect(second.failed).toBe(0);
    expect(await storageObjectExists(storageKey)).toBe(false);

    await withClient(async (client) => {
      const log = await client.query<{ count: string }>(
        'select count(*) as count from public.audio_destruction_log where object_id = $1',
        [recordingId],
      );
      // Confirming an already-destroyed object is a no-op, so no duplicate log row.
      expect(Number(log.rows[0]?.count)).toBe(1);
    });
  });

  it('resumes after a crash between claim and confirm', async () => {
    const { recordingId, storageKey } = await expiredRecording();

    // Simulate a worker that claimed the batch and died before confirming.
    await withClient(async (client) => {
      await client.query(`select public.claim_expired_audio(gen_random_uuid(), 100)`);
      await client.query(
        `update public.recordings set claimed_at = now() - interval '1 hour' where id = $1`,
        [recordingId],
      );
    });

    const result = await runPurge({ dbUrl: DB_URL });
    expect(result.failed).toBe(0);
    expect(await storageObjectExists(storageKey)).toBe(false);

    await withClient(async (client) => {
      const row = await client.query<{ purge_state: string }>(
        'select purge_state from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('destroyed');
    });
  });

  it('interleaves safely with a consent withdrawal', async () => {
    // Both delete the same object. They share the same claim/confirm machinery, so
    // whichever gets there first wins and the other is a no-op.
    const { visitId, consentId } = await committedConsentedVisit();
    const storageKey = opaqueKey();
    await uploadObject(storageKey);

    const recordingId = await withClient(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, upload_status)
         values ($1, $2, $3, $4, $5, 28, 600, 32, now(), 'uploaded')`,
        [id, visitId, world.users.puneMr.id, consentId, storageKey],
      );
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
         values (gen_random_uuid(), $1, $2, $3, 'declined', $4, 'en-IN', $5, true, now())`,
        [visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId, consentId],
      );
      return id;
    });

    const first = await runPurge({ dbUrl: DB_URL });
    const second = await runPurge({ dbUrl: DB_URL });

    expect(first.failed).toBe(0);
    expect(second.failed).toBe(0);
    expect(await storageObjectExists(storageKey)).toBe(false);

    await withClient(async (client) => {
      const row = await client.query<{ purge_state: string; destruction_reason: string }>(
        'select purge_state, destruction_reason from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('destroyed');
      expect(row.rows[0]?.destruction_reason).toBe('withdrawal');
    });
  });

  it('reports its own health, so a stopped purge is visible', async () => {
    await expiredRecording();
    await runPurge({ dbUrl: DB_URL });

    await withClient(async (client) => {
      const health = await client.query<{ payload: Record<string, unknown> }>(
        'select public.audio_purge_health() as payload',
      );
      expect(health.rows[0]?.payload['lastSuccessfulRunAt']).not.toBeNull();
      expect(Number(health.rows[0]?.payload['destroyedTotal'])).toBeGreaterThan(0);
    });
  });

  it('destroys the raw transcript alongside the audio', async () => {
    const { visitId, consentId } = await committedConsentedVisit();
    const storageKey = opaqueKey();
    await uploadObject(storageKey);

    const recordingId = await withClient(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, upload_status)
         values ($1, $2, $3, $4, $5, 28, 600, 32, now(), 'uploaded')`,
        [id, visitId, world.users.puneMr.id, consentId, storageKey],
      );
      await client.query(
        `insert into public.transcripts_raw (visit_id, recording_id, language, vendor, model_version, segments)
         values ($1, $2, 'en-IN', 'fixture', 'v0', $3)`,
        [visitId, id, JSON.stringify(SYNTHETIC_TRANSCRIPT)],
      );
      // See the comment on the same pattern in expiredRecording() above.
      await client.query(
        `update public.recordings set received_at = now() - interval '91 days',
                                      purge_after = now() - interval '5 minutes'
          where id = $1`,
        [id],
      );
      return id;
    });

    await runPurge({ dbUrl: DB_URL });

    await withClient(async (client) => {
      const remaining = await client.query<{ count: string }>(
        'select count(*) as count from public.transcripts_raw where recording_id = $1',
        [recordingId],
      );
      expect(Number(remaining.rows[0]?.count)).toBe(0);
    });
  });
});
