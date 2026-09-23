import { describe, expect, it, vi } from 'vitest';
import { noteFolder } from '../capture/voice-note-files';
import { flushOutbox, voiceNoteQueueItem } from './outbox';
import type { QueuePersistence } from './outbox';
import { SyncPushRefusal, createPushClient } from './push-client';
import type { OutboxWriteClient, VoiceNoteDeps } from './push-client';
import { emptyQueue, syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';
import { voiceNoteUploadFrom } from './voice-note-upload';
import type { VoiceNoteUpload } from './voice-note-upload';

/**
 * MR-51 D1 — `FE-W29`: a kept voice note goes to the server as an ordinary sync item.
 *
 * The order is the contract: the note is checked to be the signed-in rep's, `begin_upload` issues
 * the key, the bytes go to that key, `sync_push` finalises (`complete_upload` stores what Storage
 * observed), and only then does the phone's copy go. Every dependency is a fake, so each test says
 * which step it is about.
 */

const REP = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
const OTHER_REP = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02';
const ROOT = 'file:///data/user/0/app/files/';
const GRANT = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01';
const KEY =
  'voice-notes/0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01/0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c02.m4a';

const note: VoiceNoteUpload = {
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d01',
  noteId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e01',
  visitId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01',
  userId: REP,
  durationSeconds: 7,
  recordedAt: '2026-09-22T10:00:00.000Z',
};

const FILE = `${noteFolder(ROOT, REP)}${note.noteId}.m4a`;
const BYTES = new Uint8Array([1, 2, 3, 4, 5]).buffer;

type Rpc = { code?: string | null; message: string } | null;

/** A device with one kept note, and a server that says yes unless told otherwise. */
const world = (
  over: {
    signedIn?: string | null;
    storedAt?: string | null;
    fileThere?: boolean;
    beginError?: Rpc;
    storeFails?: boolean;
    pushError?: Rpc;
  } = {},
) => {
  const files = new Set(over.fileThere === false ? [] : [FILE]);
  const calls: string[] = [];
  const notes: VoiceNoteDeps = {
    signedInUserId: () => Promise.resolve(over.signedIn === undefined ? REP : over.signedIn),
    documentRoot: () => ROOT,
    fileExists: (uri) => {
      calls.push(`exists ${uri}`);
      return files.has(uri);
    },
    fileSize: () => 5,
    fileBytes: () => Promise.resolve(BYTES),
    removeFile: (uri) => {
      calls.push(`remove ${uri}`);
      files.delete(uri);
    },
    storeObject: vi.fn((key: string) => {
      calls.push(`store ${key}`);
      return over.storeFails === true
        ? Promise.reject(new Error('storage unreachable'))
        : Promise.resolve();
    }),
    storedAt: () => Promise.resolve(over.storedAt ?? null),
  };
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push(`rpc ${fn}`);
    if (fn === 'begin_upload') {
      return Promise.resolve(
        over.beginError
          ? { data: null, error: over.beginError }
          : { data: { id: GRANT, storage_key: KEY }, error: null },
      );
    }
    if (over.pushError) return Promise.resolve({ data: null, error: over.pushError });
    const [item] = args['p_items'] as { id: string }[];
    return Promise.resolve({
      data: {
        batchId: args['p_batch_id'],
        serverTime: '2026-09-22T10:05:00.000+00:00',
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
  return { client, rpc, calls, files, notes };
};

describe('MR-51 D1 — a kept voice note is uploaded, then finalised, then forgotten', () => {
  it('asks for a grant with the real size and duration, stores at the issued key, finalises', async () => {
    const w = world();
    const accepted = await w.client.uploadVoiceNote(note);

    expect(w.rpc).toHaveBeenCalledWith('begin_upload', {
      p_visit_id: note.visitId,
      p_kind: 'voice_note',
      p_size_bytes: 5,
      p_duration_seconds: 7,
    });
    expect(w.notes.storeObject).toHaveBeenCalledWith(KEY, BYTES);
    const push = w.rpc.mock.calls.find(([fn]) => fn === 'sync_push')?.[1];
    // The NOTE is the entity -- `complete_upload` takes it as the object id -- and the item id is
    // the queued row's own, never regenerated.
    expect(push?.['p_items']).toEqual([
      {
        id: note.id,
        entity: 'voice_note',
        entityId: note.noteId,
        payload: {
          uploadGrantId: GRANT,
          durationSeconds: 7,
          sizeBytes: 5,
          recordedAt: note.recordedAt,
        },
      },
    ]);
    expect(accepted.receivedAt).toBe('2026-09-22T10:05:00.000+00:00');
  });

  it('deletes the phone copy only AFTER the server accepted it', async () => {
    const w = world();
    await w.client.uploadVoiceNote(note);
    expect(w.files.has(FILE)).toBe(false);
    expect(w.calls.indexOf(`remove ${FILE}`)).toBeGreaterThan(w.calls.indexOf('rpc sync_push'));
  });

  it('keeps the phone copy when the finalisation got no answer — it is retried', async () => {
    const w = world({ pushError: { message: 'Network request failed' } });
    await expect(w.client.uploadVoiceNote(note)).rejects.not.toBeInstanceOf(SyncPushRefusal);
    expect(w.files.has(FILE)).toBe(true);
  });

  it('keeps the phone copy, and sends nothing, when the bytes did not land', async () => {
    const w = world({ storeFails: true });
    await expect(w.client.uploadVoiceNote(note)).rejects.toThrow('storage unreachable');
    expect(w.calls).not.toContain('rpc sync_push');
    expect(w.files.has(FILE)).toBe(true);
  });

  it('a refusal from begin_upload is the server verdict, carrying its SQLSTATE', async () => {
    const w = world({ beginError: { code: '42501', message: 'visit is not yours' } });
    const error = await w.client.uploadVoiceNote(note).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncPushRefusal);
    expect((error as SyncPushRefusal).sqlState).toBe('42501');
    expect(w.notes.storeObject).not.toHaveBeenCalled();
    expect(w.files.has(FILE)).toBe(true);
  });

  it('an expired sign-in (28000) or no answer is NOT a verdict — the note stays queued', async () => {
    for (const beginError of [
      { code: '28000', message: 'not authenticated' },
      { code: '', message: 'Network request failed' },
    ]) {
      const w = world({ beginError });
      const error = await w.client.uploadVoiceNote(note).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SyncPushRefusal);
    }
  });

  it('a note the server already holds is not uploaded twice — the lost acknowledgement', async () => {
    const w = world({ storedAt: '2026-09-22T10:04:00.000+00:00' });
    const accepted = await w.client.uploadVoiceNote(note);
    expect(w.rpc).not.toHaveBeenCalled();
    expect(w.notes.storeObject).not.toHaveBeenCalled();
    expect(w.files.has(FILE)).toBe(false);
    expect(accepted.receivedAt).toBe('2026-09-22T10:04:00.000+00:00');
  });

  it('under another sign-in, nothing is opened, read or sent (D5)', async () => {
    const w = world({ signedIn: OTHER_REP });
    await expect(w.client.uploadVoiceNote(note)).rejects.toThrow('different sign-in');
    expect(w.calls).toEqual([]);
    expect(w.rpc).not.toHaveBeenCalled();
  });

  it('a note no longer on the phone fails the attempt without asking the server for a grant', async () => {
    const w = world({ fileThere: false });
    await expect(w.client.uploadVoiceNote(note)).rejects.toThrow('no longer on this phone');
    expect(w.rpc).not.toHaveBeenCalled();
  });
});

describe('MR-51 D1 — the queue row', () => {
  it('reads back exactly what was queued', () => {
    const item = voiceNoteQueueItem(note);
    expect(item.entity).toBe('voice_note');
    expect(item.entityId).toBe(note.visitId);
    expect(voiceNoteUploadFrom(item.payload)).toEqual(note);
  });

  it('refuses a payload whose slot says something else, or whose duration is not a count', () => {
    const payload = voiceNoteQueueItem(note).payload;
    expect(voiceNoteUploadFrom({ ...payload, __queueEntity: 'recording' })).toBeNull();
    expect(voiceNoteUploadFrom({ ...payload, durationSeconds: 0 })).toBeNull();
    expect(voiceNoteUploadFrom({ ...payload, durationSeconds: 1.5 })).toBeNull();
  });

  it('a queued voice note is flushed through uploadVoiceNote, once', async () => {
    let state: SyncQueueState = syncQueueReducer(emptyQueue, {
      type: 'enqueued',
      item: voiceNoteQueueItem(note),
    });
    const store: QueuePersistence = {
      read: () => Promise.resolve({ kind: 'loaded', state }),
      write: (next) => {
        state = next;
        return Promise.resolve();
      },
    };
    const uploadVoiceNote = vi.fn(() => Promise.resolve({ receivedAt: '2026-09-22T10:05:00Z' }));
    const client = { uploadVoiceNote } as unknown as OutboxWriteClient;

    const first = await flushOutbox(client, store, () => REP);
    const second = await flushOutbox(client, store, () => REP);

    expect(uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(uploadVoiceNote).toHaveBeenCalledWith(note);
    expect(first.sent).toBe(1);
    expect(second.attempted).toBe(0);
  });
});
