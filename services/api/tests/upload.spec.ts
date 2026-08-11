import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { DB_URL, inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { API_URL, SERVICE_ROLE_KEY, asUser, mintAccessToken } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import { runPurge } from '../scripts/purge-expired-audio.mjs';

/**
 * BE-W7 — resumable upload, and the queue an MR can read.
 *
 * The property under test throughout: A GRANT COVERS THE WHOLE OBJECT AND IS
 * RE-CHECKED ON EVERY CHUNK. Resumability and a single-use consent-bound permission
 * are only compatible if that is true, so most of what follows is an attempt to
 * write bytes at a moment when it should not be true.
 *
 * No PHI. The synthetic audio is thirty-two zero bytes.
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

const SYNTHETIC_AUDIO = new Uint8Array(32);

const storageObjectExists = async (storageKey: string): Promise<boolean> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return response.ok;
};

/** As the MR, over real HTTP, with a real token. The faithful path. */
const writeChunkAsMr = async (
  user: FixtureUser,
  storageKey: string,
  method: 'POST' | 'PUT',
): Promise<number> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${mintAccessToken(user)}`,
      'content-type': 'audio/ogg',
    },
    body: SYNTHETIC_AUDIO,
  });
  return response.status;
};

/**
 * Run the purge until THIS row is destroyed.
 *
 * `claim_expired_audio` uses `for update skip locked`, so a worker started by
 * another spec file can claim this row first — and until that worker confirms, a
 * single run here reports nothing and the object is still present. That is the
 * design working: the protocol is idempotent, resumable and safe to interleave.
 * A test that asserts after exactly one run is asserting that no other worker exists.
 */
const purgeUntilDestroyed = async (
  table: 'recordings' | 'voice_notes' | 'upload_grants',
  id: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await withClient(async (client) => {
      const row = await client.query<{ purge_state: string }>(
        `select purge_state from public.${table} where id = $1`,
        [id],
      );
      return row.rows[0]?.purge_state;
    });
    if (state === 'destroyed') return;

    if (state === 'claimed') {
      // Claimed by a run that stopped before confirming — the exact crash the
      // claim/confirm split exists to survive. In production a later run picks it up
      // once the claim goes stale; the window is fifteen minutes, which is longer
      // than any test. Ageing the claim here drives the SAME recovery path rather
      // than working around it, and the assertions afterwards are unchanged.
      await withClient(async (client) => {
        await client.query(
          `update public.${table} set claimed_at = now() - interval '1 hour' where id = $1`,
          [id],
        );
      });
    }

    const result = await runPurge({ dbUrl: DB_URL });
    expect(result.failed).toBe(0);
  }
  throw new Error(`${table} ${id} was not destroyed after five purge runs`);
};

const uploadAsService = async (storageKey: string): Promise<void> => {
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

/** A committed visit with standing consent. Needed for anything crossing HTTP. */
const committedConsentedVisit = async (): Promise<{ visitId: string; consentId: string }> =>
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

/** An uncommitted visit with standing consent, for the in-transaction cases. */
const consentedVisit = async (client: Client): Promise<{ visitId: string; consentId: string }> => {
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
};

/** A withdrawal row: `declined`, superseding the standing consent. */
const withdraw = async (client: Client, visitId: string, consentId: string): Promise<void> => {
  await client.query(
    `insert into public.consent_records
       (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
        displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
     values ($1, $2, $3, $4, 'declined', $5, 'en-IN', $6, true, now())`,
    [
      randomUUID(),
      visitId,
      world.doctors.pune,
      world.users.puneMr.id,
      world.consentTextVersionId,
      consentId,
    ],
  );
};

/**
 * Backdate a session's clocks past both of them.
 *
 * `issued_at` has to move too: `upload_grants_expiry_after_issue` and
 * `upload_grants_sliding_within_hard` are real constraints, and a test that could
 * write an impossible row would be proving something about a state the system cannot
 * reach.
 */
const expireSession = async (client: Client, grantId: string): Promise<void> => {
  await client.query(
    `update public.upload_grants
        set issued_at       = now() - interval '30 hours',
            expires_at      = now() - interval '2 hours',
            hard_expires_at = now() - interval '1 hour'
      where id = $1`,
    [grantId],
  );
};

interface GrantRow {
  id: string;
  storage_key: string;
  state: string;
  bytes_received: string;
  chunk_count: number;
  expires_at: string;
  hard_expires_at: string;
  consumed_at: string | null;
}

const beginUpload = async (
  client: Client,
  visitId: string,
  kind: 'recording' | 'voice_note' = 'recording',
  sizeBytes = 4096,
): Promise<GrantRow> => {
  const result = await client.query<GrantRow>('select * from public.begin_upload($1, $2, $3, $4)', [
    visitId,
    kind,
    sizeBytes,
    240,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new Error('begin_upload returned nothing');
  return row;
};

// =============================================================================
// 1. The two clocks, and resume across a process death
// =============================================================================

describe.skipIf(!reachable)('a resumable session', () => {
  it('opens with a sliding clock and a hard ceiling the sliding clock cannot pass', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      expect(grant.state).toBe('open');
      expect(grant.storage_key).toMatch(/^recordings\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.opus$/);

      const sliding = new Date(grant.expires_at).getTime();
      const hard = new Date(grant.hard_expires_at).getTime();
      expect(hard).toBeGreaterThan(sliding);
      // Fifteen minutes and twenty-four hours. The first is a heartbeat timeout, the
      // second is the deadline after which the recording is genuinely gone.
      expect(sliding - Date.now()).toBeLessThan(20 * 60 * 1000);
      expect(hard - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    });
  });

  it('hands the same session back after the app was killed, not a new key', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const first = await beginUpload(client, visitId);
      await client.query('select public.record_upload_progress($1, $2)', [first.id, 2048]);

      // The device has lost everything it knew and asks again from scratch. This is
      // the case a resume-token-in-local-storage design fails: the token died with
      // the process.
      const second = await beginUpload(client, visitId);

      expect(second.id).toBe(first.id);
      expect(second.storage_key).toBe(first.storage_key);
      expect(Number(second.bytes_received)).toBe(2048);
    });
  });

  it('reports the server byte count on resume, not whatever the device believed', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('select public.record_upload_progress($1, $2)', [grant.id, 1024]);
      await client.query('select public.record_upload_progress($1, $2)', [grant.id, 3072]);

      const resumed = await client.query<GrantRow>('select * from public.resume_upload($1)', [
        grant.id,
      ]);
      expect(Number(resumed.rows[0]?.bytes_received)).toBe(3072);
      expect(resumed.rows[0]?.chunk_count).toBe(2);
    });
  });

  it('never lets progress push the sliding clock past the hard ceiling', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      // Bring the ceiling inside the fifteen-minute slide. Both clocks move, because
      // `upload_grants_sliding_within_hard` will not let them cross.
      await client.query('reset role');
      await client.query(
        `update public.upload_grants
            set hard_expires_at = now() + interval '3 minutes',
                expires_at      = now() + interval '3 minutes'
          where id = $1`,
        [grant.id],
      );
      await asUser(client, world.users.puneMr);

      const before = await client.query<GrantRow>(
        'select * from public.upload_grants where id = $1',
        [grant.id],
      );
      await asUser(client, world.users.puneMr);

      const after = await client.query<GrantRow>(
        'select * from public.record_upload_progress($1, $2)',
        [grant.id, 512],
      );

      // THE CEILING DOES NOT MOVE. This is the assertion that matters, and the
      // original version of this test did not make it: it only checked that the two
      // clocks ended up equal, which a mutation that raised BOTH of them satisfied
      // while destroying the property. Mutation 3 found that, not review.
      expect(new Date(after.rows[0]?.hard_expires_at ?? 0).getTime()).toBe(
        new Date(before.rows[0]?.hard_expires_at ?? 0).getTime(),
      );

      // Capped, not extended. Otherwise a device that heartbeats forever holds a
      // permission forever.
      expect(new Date(after.rows[0]?.expires_at ?? 0).getTime()).toBe(
        new Date(after.rows[0]?.hard_expires_at ?? 0).getTime(),
      );
    });
  });

  it('does not let a resume move the hard ceiling either', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      const resumed = await client.query<GrantRow>('select * from public.resume_upload($1)', [
        grant.id,
      ]);
      expect(new Date(resumed.rows[0]?.hard_expires_at ?? 0).getTime()).toBe(
        new Date(grant.hard_expires_at).getTime(),
      );
    });
  });

  it('refuses more bytes than the session declared', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId } = await consentedVisit(client);
        const grant = await beginUpload(client, visitId, 'recording', 1024);
        return client.query('select public.record_upload_progress($1, $2)', [grant.id, 999_999]);
      }),
    ).rejects.toThrow(/declared 1024 bytes/);
  });

  it('validates the declared bounds before it looks for a session to resume', async () => {
    // Otherwise a caller opens a legitimate session and then pushes an absurd size
    // past the check by asking again, because the second call short-circuits.
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId } = await consentedVisit(client);
        await beginUpload(client, visitId, 'recording', 1024);
        return client.query('select public.begin_upload($1, $2, $3, $4)', [
          visitId,
          'recording',
          Number.MAX_SAFE_INTEGER,
          240,
        ]);
      }),
    ).rejects.toThrow(/size must be between/);
  });

  it('allows one open session per visit and kind, so resume has one answer', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const recording = await beginUpload(client, visitId, 'recording');
      const note = await beginUpload(client, visitId, 'voice_note');

      expect(recording.id).not.toBe(note.id);

      const open = await client.query<{ count: string }>(
        `select count(*) as count from public.upload_grants
          where visit_id = $1 and state = 'open'`,
        [visitId],
      );
      expect(Number(open.rows[0]?.count)).toBe(2);
    });
  });
});

// =============================================================================
// 2. Consent is re-read at resume, not only at initiation
// =============================================================================

describe.skipIf(!reachable)('consent underneath an upload in flight', () => {
  it('refuses to resume once the doctor has withdrawn', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId, consentId } = await consentedVisit(client);
        const grant = await beginUpload(client, visitId);

        await client.query('reset role');
        await withdraw(client, visitId, consentId);
        await asUser(client, world.users.puneMr);

        // Bytes already in flight do not make a dead permission live again.
        return client.query('select public.resume_upload($1)', [grant.id]);
      }),
    ).rejects.toThrow(/consent has been withdrawn/);
  });

  it('refuses another chunk once the doctor has withdrawn', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId, consentId } = await consentedVisit(client);
        const grant = await beginUpload(client, visitId);

        await client.query('reset role');
        await withdraw(client, visitId, consentId);
        await asUser(client, world.users.puneMr);

        return client.query('select public.record_upload_progress($1, $2)', [grant.id, 128]);
      }),
    ).rejects.toThrow(/consent has been withdrawn/);
  });

  it('revokes the open session in the same transaction as the withdrawal', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId, consentId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await withdraw(client, visitId, consentId);

      // Not merely caught at the next chunk. A device that is offline until tomorrow
      // would otherwise hold a live permission overnight.
      const row = await client.query<{ state: string; closed_reason: string }>(
        'select state, closed_reason from public.upload_grants where id = $1',
        [grant.id],
      );
      expect(row.rows[0]?.state).toBe('revoked');
      expect(row.rows[0]?.closed_reason).toMatch(/consent withdrawn/i);
    });
  });

  it('refuses to finalise an upload whose consent went away mid-flight', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId, consentId } = await consentedVisit(client);
        const grant = await beginUpload(client, visitId);

        await client.query('reset role');
        await withdraw(client, visitId, consentId);
        await asUser(client, world.users.puneMr);

        // The last check, and the one that matters most: everything before it
        // guarded permission to WRITE bytes; this guards permission to KEEP them.
        return client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
          grant.id,
          randomUUID(),
          240,
          4096,
          new Date().toISOString(),
          28,
        ]);
      }),
    ).rejects.toThrow(/is revoked|consent has been withdrawn/);
  });
});

// =============================================================================
// 3. The storage policy, over real HTTP
// =============================================================================

describe.skipIf(!reachable)('writing chunks', () => {
  it('accepts a second write to the same object while the session is open', async () => {
    const { visitId } = await committedConsentedVisit();
    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await beginUpload(client, visitId);
      await client.query('commit');
      return row;
    });

    // BE-W6 had an INSERT policy and no UPDATE policy, so the second chunk was
    // refused and "resumable" was a word in a document.
    expect(await writeChunkAsMr(world.users.puneMr, grant.storage_key, 'POST')).toBeLessThan(300);
    expect(await writeChunkAsMr(world.users.puneMr, grant.storage_key, 'PUT')).toBeLessThan(300);
  });

  it('refuses any further write once the session is finalised', async () => {
    const { visitId } = await committedConsentedVisit();
    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await beginUpload(client, visitId);
      await client.query('commit');
      return row;
    });

    await writeChunkAsMr(world.users.puneMr, grant.storage_key, 'POST');

    await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      await client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
        grant.id,
        randomUUID(),
        240,
        4096,
        new Date().toISOString(),
        28,
      ]);
      await client.query('commit');
    });

    // Single-use means consumed at FINALISATION, not at first byte — and after
    // finalisation nothing more is written at that key by anybody.
    expect(
      await writeChunkAsMr(world.users.puneMr, grant.storage_key, 'PUT'),
    ).toBeGreaterThanOrEqual(400);
  });

  // BE-W6 refused every read by `authenticated` outright. That made the upsert above
  // impossible, because Postgres applies SELECT policies to the conflicting row.
  // The replacement is scoped to the live upload, and these three fix its edges.
  describe('the narrowed read policy', () => {
    const readAsMr = async (user: FixtureUser, storageKey: string): Promise<number> => {
      const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
        headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${mintAccessToken(user)}` },
      });
      return response.status;
    };

    const openSessionWithObject = async (): Promise<GrantRow> => {
      const { visitId } = await committedConsentedVisit();
      const grant = await withClient(async (client) => {
        await client.query('begin');
        await asUser(client, world.users.puneMr);
        const row = await beginUpload(client, visitId);
        await client.query('commit');
        return row;
      });
      await uploadAsService(grant.storage_key);
      return grant;
    };

    it('lets an MR read their own upload while it is in flight', async () => {
      const grant = await openSessionWithObject();
      expect(await readAsMr(world.users.puneMr, grant.storage_key)).toBeLessThan(300);
    });

    it('refuses an MR their own recording once it has landed', async () => {
      const grant = await openSessionWithObject();
      await withClient(async (client) => {
        await client.query('begin');
        await asUser(client, world.users.puneMr);
        await client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
          grant.id,
          randomUUID(),
          240,
          4096,
          new Date().toISOString(),
          28,
        ]);
        await client.query('commit');
      });
      // The BE-W6 property that had to survive: an MR does not download audio back.
      expect(await readAsMr(world.users.puneMr, grant.storage_key)).toBeGreaterThanOrEqual(400);
    });

    it('refuses another MR the object even while it is in flight', async () => {
      const grant = await openSessionWithObject();
      expect(await readAsMr(world.users.southMr, grant.storage_key)).toBeGreaterThanOrEqual(400);
    });
  });
});

// =============================================================================
// 4. Finalising
// =============================================================================

describe.skipIf(!reachable)('finalising an upload', () => {
  it('creates the recording, consumes the grant and closes the session', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);
      const recordingId = randomUUID();

      await client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
        grant.id,
        recordingId,
        240,
        4096,
        new Date().toISOString(),
        28,
      ]);

      const recording = await client.query<{ storage_key: string; upload_status: string }>(
        'select storage_key, upload_status from public.recordings where id = $1',
        [recordingId],
      );
      expect(recording.rows[0]?.storage_key).toBe(grant.storage_key);
      expect(recording.rows[0]?.upload_status).toBe('uploaded');

      await client.query('reset role');
      const after = await client.query<GrantRow>(
        'select * from public.upload_grants where id = $1',
        [grant.id],
      );
      expect(after.rows[0]?.state).toBe('completed');
      expect(after.rows[0]?.consumed_at).not.toBeNull();
    });
  });

  it('is idempotent, so a device that lost the response can resend', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);
      const recordingId = randomUUID();

      const args = [grant.id, recordingId, 240, 4096, new Date().toISOString(), 28];
      await client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', args);
      const second = await client.query<{ complete_upload: { alreadyCompleted: boolean } }>(
        'select public.complete_upload($1, $2, $3, $4, $5, $6) as complete_upload',
        args,
      );

      expect(second.rows[0]?.complete_upload.alreadyCompleted).toBe(true);
    });
  });

  it('refuses a finalised size that does not fit the session it was granted', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId } = await consentedVisit(client);
        const grant = await beginUpload(client, visitId, 'recording', 1024);
        return client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
          grant.id,
          randomUUID(),
          240,
          65_536,
          new Date().toISOString(),
          28,
        ]);
      }),
    ).rejects.toThrow(/does not fit the grant/);
  });

  it('starts the retention clock from the server, not from the finalising call', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);
      const recordingId = randomUUID();

      await client.query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
        grant.id,
        recordingId,
        240,
        4096,
        // The device claims the recording is ancient. The trigger does not care.
        new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
        28,
      ]);

      const row = await client.query<{ purge_after: string }>(
        'select purge_after from public.recordings where id = $1',
        [recordingId],
      );
      expect(new Date(row.rows[0]?.purge_after ?? 0).getTime()).toBeGreaterThan(
        Date.now() + 89 * 24 * 3600 * 1000,
      );
    });
  });
});

// =============================================================================
// 5. A partial upload is an object, not scratch
// =============================================================================

describe.skipIf(!reachable)('abandoned partial uploads', () => {
  it('is destroyed by the same worker, through the same machinery', async () => {
    const { visitId } = await committedConsentedVisit();

    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await beginUpload(client, visitId);
      await client.query('commit');
      return row;
    });

    // The MR started uploading and gave up. There is now audio in the bucket with no
    // recordings row binding it to a consent record.
    await uploadAsService(grant.storage_key);
    expect(await storageObjectExists(grant.storage_key)).toBe(true);

    await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      await client.query('select public.abandon_upload($1, $2)', [grant.id, 'walked out of range']);
      await client.query('commit');
    });

    await purgeUntilDestroyed('upload_grants', grant.id);

    // The assertion that matters: the OBJECT is gone, not just the row.
    expect(await storageObjectExists(grant.storage_key)).toBe(false);

    await withClient(async (client) => {
      const log = await client.query<{ reason: string; storage_key_hash: string }>(
        `select reason, storage_key_hash from public.audio_destruction_log
          where object_id = $1 and object_kind = 'upload_partial'`,
        [grant.id],
      );
      expect(log.rows[0]?.reason).toBe('abandoned_upload');
      // Hashed here as everywhere else. The log must not become the thing that
      // survives the deletion.
      expect(log.rows[0]?.storage_key_hash).not.toBe(grant.storage_key);
      expect(log.rows[0]?.storage_key_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('records a revoked session as a withdrawal rather than an abandonment', async () => {
    const { visitId, consentId } = await committedConsentedVisit();

    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await beginUpload(client, visitId);
      await client.query('commit');
      return row;
    });

    await uploadAsService(grant.storage_key);

    await withClient(async (client) => {
      await withdraw(client, visitId, consentId);
    });

    await purgeUntilDestroyed('upload_grants', grant.id);

    expect(await storageObjectExists(grant.storage_key)).toBe(false);
    await withClient(async (client) => {
      const log = await client.query<{ reason: string }>(
        `select reason from public.audio_destruction_log
          where object_id = $1 and object_kind = 'upload_partial'`,
        [grant.id],
      );
      expect(log.rows[0]?.reason).toBe('withdrawal');
    });
  });

  it('destroys the object of an upload the MR simply never came back to', async () => {
    // The gap this closes: a stalled session stays `open`, and claim_expired_audio
    // only collects partials that are `abandoned` or `revoked`. Nothing else closes
    // a session the MR never returns to — `begin_upload` only closes one if they ask
    // again for the same visit — so without the sweep inside runPurge the object
    // would sit in the bucket forever, past its retention date, with no row claiming
    // it. Found while checking that every function built this week is actually
    // called by something.
    const { visitId } = await committedConsentedVisit();
    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await beginUpload(client, visitId);
      await client.query('commit');
      return row;
    });
    await uploadAsService(grant.storage_key);

    // The device is gone. Nobody abandons anything; the clocks simply run out.
    await withClient(async (client) => {
      await expireSession(client, grant.id);
    });

    const result = await runPurge({ dbUrl: DB_URL });
    expect(result.abandoned).toBeGreaterThanOrEqual(1);

    await purgeUntilDestroyed('upload_grants', grant.id);
    expect(await storageObjectExists(grant.storage_key)).toBe(false);
  });

  it('closes a session whose clocks ran out while nobody was watching', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await expireSession(client, grant.id);

      const closed = await client.query<{ close_stale_upload_sessions: number }>(
        'select public.close_stale_upload_sessions()',
      );
      expect(closed.rows[0]?.close_stale_upload_sessions).toBeGreaterThanOrEqual(1);

      const row = await client.query<{ state: string }>(
        'select state from public.upload_grants where id = $1',
        [grant.id],
      );
      // Which is what puts it in front of the purge claim.
      expect(row.rows[0]?.state).toBe('abandoned');
    });
  });
});

// =============================================================================
// 6. Ceilings — the two things that are not about one upload
// =============================================================================

describe.skipIf(!reachable)('bounded by more than its own size', () => {
  it('counts an in-flight upload against the storage ceiling while it exists', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);

      // Read as postgres: audio_storage_bytes takes an arbitrary MR id, so granting
      // it to `authenticated` would let any MR probe a colleague's storage. Same
      // reasoning as visible_territory_ids in BE-W1.
      await client.query('reset role');
      const before = await client.query<{ audio_storage_bytes: { reservedBytes: number } }>(
        'select public.audio_storage_bytes($1) as audio_storage_bytes',
        [world.users.puneMr.id],
      );
      await asUser(client, world.users.puneMr);
      const grant = await beginUpload(client, visitId, 'recording', 8192);
      await client.query('reset role');
      const during = await client.query<{ audio_storage_bytes: { reservedBytes: number } }>(
        'select public.audio_storage_bytes($1) as audio_storage_bytes',
        [world.users.puneMr.id],
      );

      // Reserved, not merely stored. A ceiling that only counts what already landed
      // lets a device open two hundred sessions and walk straight through it.
      expect(Number(during.rows[0]?.audio_storage_bytes.reservedBytes)).toBe(
        Number(before.rows[0]?.audio_storage_bytes.reservedBytes) + 8192,
      );
      expect(grant.state).toBe('open');
    });
  });

  it('refuses a new upload that would cross the ceiling', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        await client.query('reset role');
        await client.query(
          `insert into public.app_thresholds (key, value, unit, note)
           values ('audio_storage_ceiling_bytes', '1024'::jsonb, 'bytes', 'test override')`,
        );
        const { visitId } = await consentedVisit(client);
        await asUser(client, world.users.puneMr);
        return client.query('select public.begin_upload($1, $2, $3, $4)', [
          visitId,
          'recording',
          4096,
          240,
        ]);
      }),
    ).rejects.toThrow(/storage ceiling/);
  });

  it('refuses new audio once the retention worker has demonstrably stopped', async () => {
    // The control that cannot be switched off. The scheduler and its watchdog both
    // live outside the database; this is on the write path. If retention has
    // stopped, intake stops.
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        const { visitId, consentId } = await consentedVisit(client);

        await client.query('reset role');
        const orphan = randomUUID();
        await client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
              duration_seconds, size_bytes, recorded_at, purge_after)
           values ($1, $2, $3, $4, $5, 28, 240, 32, now(), now())`,
          [
            orphan,
            visitId,
            world.users.puneMr.id,
            consentId,
            `recordings/${randomUUID()}/${randomUUID()}.opus`,
          ],
        );
        // Ten days past its purge date, well beyond the 48-hour silence window.
        await client.query(
          `update public.recordings set purge_after = now() - interval '10 days' where id = $1`,
          [orphan],
        );

        const stalled = await client.query<{ audio_purge_is_stalled: boolean }>(
          'select public.audio_purge_is_stalled()',
        );
        expect(stalled.rows[0]?.audio_purge_is_stalled).toBe(true);

        const { visitId: fresh } = await consentedVisit(client);
        await asUser(client, world.users.puneMr);
        return client.query('select public.begin_upload($1, $2, $3, $4)', [
          fresh,
          'recording',
          4096,
          240,
        ]);
      }),
    ).rejects.toThrow(/retention worker has stopped/);
  });
});

// =============================================================================
// 7. The queue — one mechanism, not two
// =============================================================================

describe.skipIf(!reachable)('the upload queue', () => {
  const push = async (
    client: Client,
    items: unknown[],
  ): Promise<{ results: Record<string, unknown>[] }> => {
    const result = await client.query<{ sync_push: { results: Record<string, unknown>[] } }>(
      'select public.sync_push($1, $2) as sync_push',
      [randomUUID(), JSON.stringify(items)],
    );
    const value = result.rows[0]?.sync_push;
    if (value === undefined) throw new Error('sync_push returned nothing');
    return value;
  };

  const recordingItem = (grantId: string, entityId: string): Record<string, unknown> => ({
    id: randomUUID(),
    entity: 'recording',
    operation: 'create',
    entityId,
    clientCreatedAt: new Date().toISOString(),
    payload: {
      uploadGrantId: grantId,
      durationSeconds: 240,
      sizeBytes: 4096,
      bitrateKbps: 28,
      recordedAt: new Date().toISOString(),
    },
  });

  it('accepts a finalised recording through the ordinary queue', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);
      const recordingId = randomUUID();

      const response = await push(client, [recordingItem(grant.id, recordingId)]);
      expect(response.results[0]?.['status']).toBe('accepted');

      const row = await client.query<{ count: string }>(
        'select count(*) as count from public.recordings where id = $1',
        [recordingId],
      );
      expect(Number(row.rows[0]?.count)).toBe(1);
    });
  });

  it('names a withdrawal as a withdrawal, and says so in words an MR can read', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId, consentId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await withdraw(client, visitId, consentId);
      await asUser(client, world.users.puneMr);

      const response = await push(client, [recordingItem(grant.id, randomUUID())]);
      expect(response.results[0]?.['status']).toBe('rejected');
      expect(response.results[0]?.['rejectionCode']).toBe('consent_withdrawn');

      const explained = await client.query<{ sync_rejection_explanation: string }>(
        `select public.sync_rejection_explanation('consent_withdrawn')`,
      );
      // Not 'the server refused the contents of this item', which is untrue and
      // unactionable — and is what this would have said before BE-W7.
      expect(explained.rows[0]?.sync_rejection_explanation).toMatch(/you did nothing wrong/i);
    });
  });

  it('names an expired upload as expired', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await expireSession(client, grant.id);
      await asUser(client, world.users.puneMr);

      const response = await push(client, [recordingItem(grant.id, randomUUID())]);
      expect(response.results[0]?.['rejectionCode']).toBe('upload_expired');
    });
  });

  it('has a sentence for every rejection code, so none can degrade to silence', async () => {
    // A code with no explanation renders as a blank reason to the MR, which is the
    // same as no reason at all. This is also what stops the vocabulary growing codes
    // nobody wrote a sentence for.
    await inRolledBackTransaction(async (client) => {
      const missing = await client.query<{ code: string }>(
        `select e.enumlabel as code
           from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'sync_rejection_code'
            and public.sync_rejection_explanation(e.enumlabel::public.sync_rejection_code) is null`,
      );
      expect(missing.rows.map((r) => r.code)).toEqual([]);
    });
  });

  it('shows the MR what is queued, what failed and why', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId, 'recording', 8192);
      await client.query('select public.record_upload_progress($1, $2)', [grant.id, 4096]);

      const queue = await client.query<{
        upload_grant_id: string;
        state: string;
        percent_complete: number;
        explanation: string | null;
      }>('select * from public.my_upload_queue($1)', [world.users.puneMr.id]);

      const row = queue.rows.find((r) => r.upload_grant_id === grant.id);
      expect(row?.state).toBe('open');
      expect(row?.percent_complete).toBe(50);
      expect(row?.explanation).toBe('Still uploading.');
    });
  });

  it('explains a revoked upload without the MR having to ask anybody', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId, consentId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await withdraw(client, visitId, consentId);
      await asUser(client, world.users.puneMr);

      const queue = await client.query<{ upload_grant_id: string; explanation: string | null }>(
        'select * from public.my_upload_queue($1)',
        [world.users.puneMr.id],
      );
      const row = queue.rows.find((r) => r.upload_grant_id === grant.id);
      expect(row?.explanation).toMatch(/withdrew consent/i);
    });
  });

  it('inherits dead-lettering and reinstatement rather than inventing a second mechanism', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const { visitId, consentId } = await consentedVisit(client);
      const grant = await beginUpload(client, visitId);

      await client.query('reset role');
      await withdraw(client, visitId, consentId);
      await asUser(client, world.users.puneMr);

      const item = recordingItem(grant.id, randomUUID());
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await push(client, [item]);
      }

      const dead = await client.query<{ status: string; rejection_code: string }>(
        'select status, rejection_code from public.sync_items where id = $1',
        [item['id']],
      );
      expect(dead.rows[0]?.status).toBe('dead_lettered');
      expect(dead.rows[0]?.rejection_code).toBe('consent_withdrawn');

      // And the BE-W5 reversal works on it unchanged, with a mandatory reason.
      await asUser(client, world.users.westManager);
      await client.query('select public.reinstate_sync_item($1, $2)', [
        item['id'],
        'Doctor re-consented in person; confirmed by the manager.',
      ]);

      const reinstated = await client.query<{ status: string; attempts_forgiven: number }>(
        'select status, attempts_forgiven from public.sync_items where id = $1',
        [item['id']],
      );
      expect(reinstated.rows[0]?.status).toBe('rejected');
      expect(reinstated.rows[0]?.attempts_forgiven).toBeGreaterThan(0);
    });
  });
});
