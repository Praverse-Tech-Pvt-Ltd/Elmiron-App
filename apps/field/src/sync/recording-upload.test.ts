import { describe, expect, it, vi } from 'vitest';
import { recordingFolder } from '../capture/voice-note-files';
import { flushOutbox, recordingQueueItem } from './outbox';
import type { QueuePersistence } from './outbox';
import { SyncPushRefusal, createPushClient } from './push-client';
import type { OutboxWriteClient, VoiceNoteDeps } from './push-client';
import { emptyQueue, syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';
import { recordingUploadFrom } from './voice-note-upload';
import type { RecordingUpload } from './voice-note-upload';

/**
 * MR-53 C1/C2 — a consultation recording goes through the voice-note sender, not beside it.
 *
 * What these pin is the two things that differ, and the several that must NOT: the kind asked of
 * `begin_upload` (where the consent check lives), the folder the file was kept in, and otherwise
 * the same order — own file, server's key, bytes, finalise, and only then delete.
 */
const REP = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
const ROOT = 'file:///data/user/0/app/files/';
const GRANT = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01';
const KEY =
  'recordings/0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01/0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c02.m4a';

const recording: RecordingUpload = {
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d01',
  noteId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e01',
  visitId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01',
  userId: REP,
  durationSeconds: 90,
  bitrateKbps: 128,
  recordedAt: '2026-09-23T10:00:00.000Z',
};

const FILE = `${recordingFolder(ROOT, REP)}${recording.noteId}.m4a`;
const BYTES = new Uint8Array([9, 9, 9]).buffer;

const world = (over: { beginError?: { code?: string; message: string } } = {}) => {
  const files = new Set([FILE]);
  const notes: VoiceNoteDeps = {
    signedInUserId: () => Promise.resolve(REP),
    documentRoot: () => ROOT,
    fileExists: (uri) => files.has(uri),
    fileSize: () => 3,
    fileBytes: () => Promise.resolve(BYTES),
    removeFile: (uri) => {
      files.delete(uri);
    },
    storeObject: vi.fn(() => Promise.resolve()),
    storedAt: () => Promise.resolve(null),
  };
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'begin_upload') {
      return Promise.resolve(
        over.beginError
          ? { data: null, error: over.beginError }
          : { data: { id: GRANT, storage_key: KEY }, error: null },
      );
    }
    const [item] = args['p_items'] as { id: string }[];
    return Promise.resolve({
      data: {
        batchId: args['p_batch_id'],
        serverTime: '2026-09-23T10:05:00.000+00:00',
        results: [
          {
            id: item?.id,
            status: 'accepted',
            rejectionCode: null,
            sqlState: null,
            sqlDetail: null,
            sqlHint: null,
            rejectionDetail: null,
            warnings: [],
          },
        ],
        queues: [],
      },
      error: null,
    });
  });
  const client = createPushClient({
    client: { rpc },
    newBatchId: () => '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0bff',
    voiceNotes: notes,
  });
  return { client, rpc, files, notes };
};

describe('MR-53 C1 — the recording uses the voice-note path', () => {
  it('asks begin_upload for a RECORDING, which is where the consent check lives', async () => {
    const w = world();
    await w.client.uploadRecording(recording);
    expect(w.rpc).toHaveBeenCalledWith('begin_upload', {
      p_visit_id: recording.visitId,
      p_kind: 'recording',
      p_size_bytes: 3,
      p_duration_seconds: 90,
    });
  });

  it('reads the file from the recordings folder, not the voice-note one', async () => {
    const w = world();
    await w.client.uploadRecording(recording);
    // The file was found and consumed: had the sender looked in `voice-notes/`, it would have
    // thrown "no longer on this phone" instead.
    expect(w.files.has(FILE)).toBe(false);
  });

  it('finalises as a recording sync item carrying the bitrate complete_upload records', async () => {
    const w = world();
    await w.client.uploadRecording(recording);
    const push = w.rpc.mock.calls.find(([fn]) => fn === 'sync_push')?.[1];
    expect(push?.['p_items']).toEqual([
      {
        id: recording.id,
        entity: 'recording',
        entityId: recording.noteId,
        payload: {
          uploadGrantId: GRANT,
          durationSeconds: 90,
          sizeBytes: 3,
          recordedAt: recording.recordedAt,
          bitrateKbps: 128,
        },
      },
    ]);
  });

  it('C2: the key the server issued is used as given, and it is a .m4a', async () => {
    const w = world();
    await w.client.uploadRecording(recording);
    // BE-W111 (MR-52 C1): the container the phone writes is AAC in MP4, and the server now names
    // it so. The client never rewrites the key.
    expect(w.notes.storeObject).toHaveBeenCalledWith(KEY, BYTES);
    expect(KEY.endsWith('.m4a')).toBe(true);
  });

  it('B4: a withdrawal refuses the upload as a server verdict, and the file stays', async () => {
    const w = world({
      beginError: {
        code: '42501',
        message: 'visit has no standing consent; there is no upload path',
      },
    });
    const error = await w.client.uploadRecording(recording).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncPushRefusal);
    expect((error as SyncPushRefusal).sqlState).toBe('42501');
    // Kept, not deleted: a refusal is not proof the recording should be destroyed, and the MR is
    // told. Destroying it here would also destroy the only copy of something a manager may need
    // to know existed.
    expect(w.files.has(FILE)).toBe(true);
    expect(w.notes.storeObject).not.toHaveBeenCalled();
  });
});

describe('MR-53 C4 — a second rep on the same phone', () => {
  it('cannot upload the first rep’s recording, and does not open their folder', async () => {
    const w = world();
    const opened: string[] = [];
    const theirs: VoiceNoteDeps = {
      ...w.notes,
      signedInUserId: () => Promise.resolve('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02'),
      fileExists: (uri) => {
        opened.push(uri);
        return true;
      },
    };
    const client = createPushClient({
      client: { rpc: w.rpc },
      newBatchId: () => 'b',
      voiceNotes: theirs,
    });

    await expect(client.uploadRecording(recording)).rejects.toThrow('different sign-in');
    expect(opened, 'the other rep’s folder is never even looked at').toEqual([]);
    expect(w.rpc).not.toHaveBeenCalled();
  });
});

describe('MR-53 C1 — the queue row', () => {
  it('reads back exactly what was queued, bitrate included', () => {
    const item = recordingQueueItem(recording);
    expect(item.entity).toBe('recording');
    expect(item.entityId).toBe(recording.visitId);
    expect(recordingUploadFrom(item.payload)).toEqual(recording);
  });

  it('refuses a payload whose slot says voice_note, or whose bitrate is not a count', () => {
    const payload = recordingQueueItem(recording).payload;
    expect(recordingUploadFrom({ ...payload, __queueEntity: 'voice_note' })).toBeNull();
    expect(recordingUploadFrom({ ...payload, bitrateKbps: 0 })).toBeNull();
    expect(recordingUploadFrom({ ...payload, bitrateKbps: '128' })).toBeNull();
  });

  it('a queued recording is flushed through uploadRecording, once', async () => {
    let state: SyncQueueState = syncQueueReducer(emptyQueue, {
      type: 'enqueued',
      item: recordingQueueItem(recording),
    });
    const store: QueuePersistence = {
      read: () => Promise.resolve({ kind: 'loaded', state }),
      write: (next) => {
        state = next;
        return Promise.resolve();
      },
    };
    const uploadRecording = vi.fn(() => Promise.resolve({ receivedAt: '2026-09-23T10:05:00Z' }));
    const client = { uploadRecording } as unknown as OutboxWriteClient;

    const first = await flushOutbox(client, store, () => REP);
    const second = await flushOutbox(client, store, () => REP);

    expect(uploadRecording).toHaveBeenCalledTimes(1);
    expect(uploadRecording).toHaveBeenCalledWith(recording);
    expect(first.sent).toBe(1);
    expect(second.attempted).toBe(0);
  });
});
