import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { TranscriptV1Schema } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asDatabaseRole, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-53 D — a `TranscriptV1` can be written, by a service identity, and only when it is true.
 *
 * **The contract has existed since MR-50 B with nothing able to write one.** The TABLES have
 * existed since MR-14 — which is why the withdrawal cascade already deletes transcripts — so their
 * shape governs and this is a door, not a new room.
 *
 * The fixture is PARSED THROUGH `TranscriptV1Schema` by default, so a valid case cannot silently
 * drift from the contract. The D3 cases pass `unchecked` on purpose: the contract refuses a span
 * past the end and an overlap too, so a parsed fixture could never reach the SERVER's copy of those
 * rules — and a vendor posting raw JSON to PostgREST never touches the TypeScript contract at all.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Segment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

const transcriptFor = (
  recordingId: string,
  visitId: string,
  over: { durationMs?: number; segments?: readonly Segment[]; unchecked?: boolean } = {},
): unknown => {
  const segments = over.segments ?? [
    { startMs: 0, endMs: 2_000, text: 'Doctor sahab, namaste.' },
    { startMs: 2_000, endMs: 5_000, text: 'BP ki dose kam kar dijiye.' },
  ];
  const transcript = {
    schemaVersion: 'v1' as const,
    id: randomUUID(),
    visitId,
    source: { kind: 'recording' as const, recordingId },
    vendor: 'MR-53 test vendor',
    modelVersion: 'test-1',
    primaryLanguage: 'en-IN',
    durationMs: over.durationMs ?? 5_000,
    transcribedAt: new Date().toISOString(),
    segments: segments.map((segment, index) => ({
      id: randomUUID(),
      index,
      speakerLabel: index % 2 === 0 ? 'mr' : 'doctor',
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      language: 'en-IN',
      confidence: 0.9,
      tokens: [
        {
          text: segment.text,
          startChar: 0,
          // Code points, as `transcript-v1.ts` counts them -- `Array.from`, never `split('')`.
          endChar: Array.from(segment.text).length,
          language: 'en-IN',
        },
      ],
    })),
  };
  // **Parsed by default, and deliberately NOT parsed for the cases the contract also refuses.**
  //
  // `TranscriptV1Schema` rejects a span past the end of the audio and an overlap, so a fixture that
  // went through it could never reach the server's own check. A vendor posting raw JSON to
  // PostgREST does not go through the TypeScript contract at all, which is exactly why the server
  // repeats these rules — and why they have to be provable here without it.
  return over.unchecked === true ? transcript : TranscriptV1Schema.parse(transcript);
};

/** A recording of the Pune visit, with a standing consent already in the fixture. */
const recordingFor = async (client: Client, over: { durationSeconds?: number } = {}) => {
  const id = randomUUID();
  await client.query('set local role postgres');
  await client.query(
    `insert into public.recordings
       (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps, duration_seconds,
        size_bytes, upload_status, recorded_at, purge_after)
     values ($1, $2, $3, $4, $5, 128, $6, 1024, 'uploaded', now(), now() + interval '90 days')`,
    [
      id,
      world.visits.pune,
      world.users.puneMr.id,
      world.consentRecords.pune,
      `recordings/${randomUUID()}/${randomUUID()}.m4a`,
      over.durationSeconds ?? 10,
    ],
  );
  return id;
};

const ingestAs = async (
  client: Client,
  role: 'authenticated' | 'anon' | 'service_role',
  transcript: unknown,
) => {
  await asDatabaseRole(client, role);
  return client.query<{ result: Record<string, unknown> }>(
    'select public.ingest_transcript($1::jsonb) as result',
    [JSON.stringify(transcript)],
  );
};

describe.skipIf(!reachable)('MR-53 D1 — a transcript can be written for a recording', () => {
  it('writes it, returns what it wrote, and logs the write', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune) as { id: string };

      const { rows } = await ingestAs(client, 'service_role', transcript);
      expect(rows[0]?.result['transcriptId']).toBe(transcript.id);
      expect(rows[0]?.result['segments']).toBe(2);

      await client.query('set local role postgres');
      const stored = await client.query<{ vendor: string; segments: unknown[]; visit_id: string }>(
        'select vendor, segments, visit_id from public.transcripts_raw where id = $1',
        [transcript.id],
      );
      expect(stored.rows[0]?.vendor).toBe('MR-53 test vendor');
      expect(stored.rows[0]?.visit_id).toBe(world.visits.pune);
      expect(stored.rows[0]?.segments).toHaveLength(2);

      const audit = await client.query<{ action: string; table_name: string }>(
        'select action, table_name from public.audit_log where id = $1',
        [rows[0]?.result['auditLogId']],
      );
      expect(audit.rows[0]).toEqual({ action: 'insert', table_name: 'transcripts_raw' });
    });
  });

  it('a retry after a lost acknowledgement writes one row, not two', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune) as { id: string };

      await ingestAs(client, 'service_role', transcript);
      await ingestAs(client, 'service_role', transcript);

      await client.query('set local role postgres');
      const { rows } = await client.query<{ count: string }>(
        'select count(*) as count from public.transcripts_raw where id = $1',
        [transcript.id],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });
});

describe.skipIf(!reachable)('MR-53 D2 — only a service identity may write one', () => {
  it('an MR is refused, by the grant, before any row is read', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune);

      await asUser(client, world.users.puneMr);
      const refusal = await client
        .query('select public.ingest_transcript($1::jsonb)', [JSON.stringify(transcript)])
        .catch((error: unknown) => error as { message?: string });
      expect((refusal as { message?: string }).message).toMatch(/permission denied/u);
    });
  });

  it('an admin of ANOTHER organisation is refused the same way', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune);

      await asUser(client, world.users.rivalAdmin);
      const refusal = await client
        .query('select public.ingest_transcript($1::jsonb)', [JSON.stringify(transcript)])
        .catch((error: unknown) => error as { message?: string });
      expect((refusal as { message?: string }).message).toMatch(/permission denied/u);
    });
  });

  it('POSITIVE CONTROL: the same transcript from the service identity is accepted', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune);
      const { rows } = await ingestAs(client, 'service_role', transcript);
      expect(rows[0]?.result['transcriptId']).toBeTruthy();
    });
  });
});

describe.skipIf(!reachable)('MR-53 D3 — the failures a vendor actually produces', () => {
  it('refuses a segment that ends past the end of the audio', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune, {
        durationMs: 5_000,
        unchecked: true,
        segments: [
          { startMs: 0, endMs: 2_000, text: 'inside' },
          // A segmenter that padded the tail.
          { startMs: 2_000, endMs: 9_000, text: 'past the end' },
        ],
      });
      // The CONTRACT refuses this too; `unchecked` is what lets the SERVER's copy be tested.
      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { code?: string; message?: string },
      );
      expect((refusal as { message?: string }).message).toMatch(/past the end of/u);
    });
  });

  it('refuses segments that overlap — two speakers diarised onto one timeline', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune, {
        unchecked: true,
        segments: [
          { startMs: 0, endMs: 3_000, text: 'the MR' },
          { startMs: 1_500, endMs: 5_000, text: 'the doctor, over the top' },
        ],
      });
      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { message?: string },
      );
      expect((refusal as { message?: string }).message).toMatch(/inside the segment before it/u);
    });
  });

  it('refuses a transcript longer than the recording it claims to be of', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client, { durationSeconds: 4 });
      const transcript = transcriptFor(recordingId, world.visits.pune, { durationMs: 5_000 });
      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { message?: string },
      );
      expect((refusal as { message?: string }).message).toMatch(/but the recording is/u);
    });
  });

  it('refuses a transcript filed against a different visit than the audio’s', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.south);
      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { message?: string },
      );
      expect((refusal as { message?: string }).message).toMatch(/but the audio belongs to visit/u);
    });
  });

  it('refuses a schemaVersion it does not know, rather than guessing', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = {
        ...(transcriptFor(recordingId, world.visits.pune) as Record<string, unknown>),
        schemaVersion: 'v2',
      };
      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { message?: string },
      );
      expect((refusal as { message?: string }).message).toMatch(/unsupported transcript/u);
    });
  });
});

describe.skipIf(!reachable)('MR-53 D5 — a withdrawn consent refuses the transcript', () => {
  it('refuses after the doctor has withdrawn, whatever the job already believes', async () => {
    await inRolledBackTransaction(async (client) => {
      const recordingId = await recordingFor(client);
      const transcript = transcriptFor(recordingId, world.visits.pune);

      await client.query('set local role postgres');
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
         select $1, c.visit_id, c.doctor_id, c.captured_by_mr_id, 'declined',
                c.consent_text_version_id, c.displayed_language, c.id, true, now()
           from public.consent_records c where c.id = $2`,
        [randomUUID(), world.consentRecords.pune],
      );

      const refusal = await ingestAs(client, 'service_role', transcript).catch(
        (error: unknown) => error as { code?: string; message?: string },
      );
      expect((refusal as { code?: string }).code).toBe('42501');
      expect((refusal as { message?: string }).message).toMatch(
        /consent for visit .* not standing/u,
      );
    });
  });
});
