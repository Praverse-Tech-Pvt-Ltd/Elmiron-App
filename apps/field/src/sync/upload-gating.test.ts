import { describe, expect, it, vi } from 'vitest';
import type { CreateCheckInRequest } from '@fieldforce/core';
import {
  checkInQueueItem,
  flushOutbox,
  recordingQueueItem,
  sendOrQueue,
  voiceNoteQueueItem,
} from './outbox';
import type { QueuePersistence } from './outbox';
import type { OutboxWriteClient } from './push-client';
import { emptyQueue } from './reducer';
import type { SyncQueueState } from './reducer';
import { connectionFrom, heldAudioIds, heldForWifi, sendingAudioAnyway } from './upload-conditions';
import type { Connection, UploadConditions, UploadUse } from './upload-conditions';

/**
 * `FE-W135` — "Send audio on WiFi only": voice notes and visit recordings wait while the phone is
 * not on WiFi; everything else sends exactly as before. `FE-W137` — what goes over mobile data is
 * counted. Every condition is a fake, so each test names the network it is about.
 */

const REP = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
const VISIT = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01';
const SERVER_TIME = '2026-10-14T06:00:00.000+00:00';

const note = {
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d01',
  noteId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e01',
  visitId: VISIT,
  userId: REP,
  durationSeconds: 7,
  recordedAt: '2026-10-14T05:00:00.000Z',
};

const recording = {
  ...note,
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d02',
  noteId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e02',
  bitrateKbps: 128,
};

const checkIn: CreateCheckInRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  visitId: VISIT,
  coordinates: {
    latitude: 19.07,
    longitude: 72.87,
    accuracyMetres: null,
    capturedAt: '2026-10-14T05:00:00.000Z',
  },
  source: 'manual',
  occurredAt: '2026-10-14T05:00:00.000Z',
};

const conditions = (
  connection: Connection,
  wifiOnlyAudio = true,
): UploadConditions & { uses: UploadUse[] } => {
  const uses: UploadUse[] = [];
  return {
    uses,
    read: () => Promise.resolve({ connection, wifiOnlyAudio }),
    recordUse: (use) => {
      uses.push(use);
      return Promise.resolve();
    },
  };
};

const inMemory = (
  initial: SyncQueueState = emptyQueue,
): QueuePersistence & { current: () => SyncQueueState } => {
  let state = initial;
  return {
    read: () => Promise.resolve({ kind: 'loaded', state }),
    write: (next) => {
      state = next;
      return Promise.resolve();
    },
    current: () => state,
  };
};

const accepted = (bytesSent: number) => ({ receivedAt: SERVER_TIME, warnings: [], bytesSent });

const client = () => {
  const uploadVoiceNote = vi.fn(() => Promise.resolve(accepted(400_000)));
  const uploadRecording = vi.fn(() => Promise.resolve(accepted(1_600_000)));
  const createCheckIn = vi.fn(() => Promise.resolve(accepted(600)));
  return {
    uploadVoiceNote,
    uploadRecording,
    createCheckIn,
    client: { uploadVoiceNote, uploadRecording, createCheckIn } as unknown as OutboxWriteClient,
  };
};

/** A queue holding a voice note, a recording and a check-in, none of them tried yet. */
const queueOfThree = async (): Promise<QueuePersistence & { current: () => SyncQueueState }> => {
  const store = inMemory();
  const offline = conditions('none', false);
  for (const item of [
    voiceNoteQueueItem(note),
    recordingQueueItem(recording),
    checkInQueueItem(checkIn),
  ]) {
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      item,
      store,
      offline,
    );
  }
  return store;
};

describe('FE-W135 — on mobile data, audio waits and everything else goes', () => {
  it('sends the check-in and leaves both audio rows queued, untried', async () => {
    const store = await queueOfThree();
    const before = store.current().items.map((item) => [item.id, item.attemptCount]);
    const fake = client();

    const result = await flushOutbox(fake.client, store, () => REP, conditions('mobile'));

    expect(fake.createCheckIn).toHaveBeenCalledTimes(1);
    expect(fake.uploadVoiceNote).not.toHaveBeenCalled();
    expect(fake.uploadRecording).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, sent: 1, stillQueued: 2, heldForWifi: 2 });

    // Held is not failed: no attempt counted, no error written, still `queued`. A recording that
    // waits all week for WiFi must never drift toward "Still trying".
    for (const item of store.current().items.filter((i) => i.entity !== 'check_in')) {
      expect(item.status).toBe('queued');
      expect(item.lastError).toBeNull();
      expect(item.attemptCount).toBe(before.find(([id]) => id === item.id)?.[1]);
    }
  });

  it('an UNKNOWN network is not WiFi: audio waits', async () => {
    const store = await queueOfThree();
    const fake = client();
    await flushOutbox(fake.client, store, () => REP, conditions('unknown'));
    expect(fake.uploadVoiceNote).not.toHaveBeenCalled();
    expect(fake.uploadRecording).not.toHaveBeenCalled();
    expect(fake.createCheckIn).toHaveBeenCalledTimes(1);
  });

  it('on WiFi, the audio goes', async () => {
    const store = await queueOfThree();
    const fake = client();
    const result = await flushOutbox(fake.client, store, () => REP, conditions('wifi'));
    expect(fake.uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(fake.uploadRecording).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 3, sent: 3, stillQueued: 0 });
  });

  it('with the switch OFF, audio goes on mobile data too', async () => {
    const store = await queueOfThree();
    const fake = client();
    await flushOutbox(fake.client, store, () => REP, conditions('mobile', false));
    expect(fake.uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(fake.uploadRecording).toHaveBeenCalledTimes(1);
  });

  it('a queue of nothing but held audio is left exactly as it was', async () => {
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('x')),
      voiceNoteQueueItem(note),
      store,
      conditions('none', false),
    );
    const before = store.current();
    const fake = client();
    const result = await flushOutbox(fake.client, store, () => REP, conditions('mobile'));
    expect(result).toEqual({ attempted: 0, sent: 0, stillQueued: 1, heldForWifi: 1 });
    expect(store.current()).toBe(before);
  });

  it('"Send now" on the queue screen sends audio over mobile data, this once', async () => {
    const store = await queueOfThree();
    const fake = client();
    const mobile = conditions('mobile');
    await flushOutbox(fake.client, store, () => REP, sendingAudioAnyway(mobile));
    expect(fake.uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(fake.uploadRecording).toHaveBeenCalledTimes(1);
    // And the switch is untouched: the next ordinary flush on mobile data would hold again.
    await expect(mobile.read()).resolves.toEqual({ connection: 'mobile', wifiOnlyAudio: true });
  });
});

describe('FE-W135 — the immediate send, from the voice-note and visit screens', () => {
  it('on mobile data, a voice note is queued for WiFi WITHOUT trying', async () => {
    const store = inMemory();
    const send = vi.fn(() => Promise.resolve(accepted(400_000)));
    const outcome = await sendOrQueue(send, voiceNoteQueueItem(note), store, conditions('mobile'));
    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'queued', waitingForWifi: true });
    expect(store.current().items.map((item) => item.entity)).toEqual(['voice_note']);
  });

  it('a recording is held the same way', async () => {
    const store = inMemory();
    const send = vi.fn(() => Promise.resolve(accepted(1)));
    const outcome = await sendOrQueue(
      send,
      recordingQueueItem(recording),
      store,
      conditions('unknown'),
    );
    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'queued', waitingForWifi: true });
  });

  it('a check-in on mobile data is sent at once, exactly as before', async () => {
    const store = inMemory();
    const send = vi.fn(() => Promise.resolve(accepted(600)));
    const outcome = await sendOrQueue(send, checkInQueueItem(checkIn), store, conditions('mobile'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'sent', warnings: [] });
  });

  it('on WiFi, a voice note is sent at once', async () => {
    const send = vi.fn(() => Promise.resolve(accepted(400_000)));
    const outcome = await sendOrQueue(
      send,
      voiceNoteQueueItem(note),
      inMemory(),
      conditions('wifi'),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('sent');
  });

  it('a held note on an unreadable queue says so, rather than claiming it waits', async () => {
    const store: QueuePersistence = {
      read: () => Promise.resolve({ kind: 'unreadable' }),
      write: vi.fn(() => Promise.resolve()),
    };
    const outcome = await sendOrQueue(
      () => Promise.resolve({}),
      voiceNoteQueueItem(note),
      store,
      conditions('mobile'),
    );
    expect(outcome).toEqual({ kind: 'queue_unreadable' });
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('FE-W137 — what is counted toward the month', () => {
  it('counts each accepted send over mobile data, with the server time that decides the month', async () => {
    const store = await queueOfThree();
    const fake = client();
    const mobile = conditions('mobile', false);
    await flushOutbox(fake.client, store, () => REP, mobile);
    expect(mobile.uses).toEqual([
      { bytes: 400_000, serverTime: SERVER_TIME },
      { bytes: 1_600_000, serverTime: SERVER_TIME },
      { bytes: 600, serverTime: SERVER_TIME },
    ]);
  });

  it('counts nothing on WiFi', async () => {
    const store = await queueOfThree();
    const wifi = conditions('wifi');
    await flushOutbox(client().client, store, () => REP, wifi);
    expect(wifi.uses).toEqual([]);
  });

  it('counts an immediate send too, and nothing for one that never got an answer', async () => {
    const mobile = conditions('mobile');
    await sendOrQueue(
      () => Promise.resolve(accepted(600)),
      checkInQueueItem(checkIn),
      inMemory(),
      mobile,
    );
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem({ ...checkIn, id: '11111111-1111-4111-8111-111111111112' }),
      inMemory(),
      mobile,
    );
    expect(mobile.uses).toEqual([{ bytes: 600, serverTime: SERVER_TIME }]);
  });

  it('a response with no byte figure or no server time counts nothing', async () => {
    const mobile = conditions('mobile');
    await sendOrQueue(
      () => Promise.resolve({ receivedAt: SERVER_TIME }),
      checkInQueueItem(checkIn),
      inMemory(),
      mobile,
    );
    await sendOrQueue(
      () => Promise.resolve({ bytesSent: 10 }),
      checkInQueueItem(checkIn),
      inMemory(),
      mobile,
    );
    expect(mobile.uses).toEqual([]);
  });

  it('a count that cannot be written never costs the send', async () => {
    const broken: UploadConditions = {
      read: () => Promise.resolve({ connection: 'mobile', wifiOnlyAudio: true }),
      recordUse: () => Promise.reject(new Error('storage full')),
    };
    const outcome = await sendOrQueue(
      () => Promise.resolve(accepted(600)),
      checkInQueueItem(checkIn),
      inMemory(),
      broken,
    );
    expect(outcome.kind).toBe('sent');
  });
});

describe('FE-W136 — which rows the screens call "waiting for WiFi"', () => {
  it('only queued audio, only while held, and nothing before the snapshot is read', async () => {
    const store = await queueOfThree();
    const items = store.current().items;
    const audioIds = items.filter((item) => item.entity !== 'check_in').map((item) => item.id);
    expect(heldAudioIds(items, { connection: 'mobile', wifiOnlyAudio: true })).toEqual(audioIds);
    expect(heldAudioIds(items, { connection: 'wifi', wifiOnlyAudio: true })).toEqual([]);
    expect(heldAudioIds(items, { connection: 'mobile', wifiOnlyAudio: false })).toEqual([]);
    expect(heldAudioIds(items, null)).toEqual([]);
    const inFlight = items.map((item) => ({ ...item, status: 'in_flight' as const }));
    expect(heldAudioIds(inFlight, { connection: 'mobile', wifiOnlyAudio: true })).toEqual([]);
  });
});

describe('FE-W135 — reading the network', () => {
  it('only WIFI is WiFi; anything the phone cannot name is unknown', () => {
    expect(connectionFrom('WIFI', true)).toBe('wifi');
    expect(connectionFrom('CELLULAR', true)).toBe('mobile');
    expect(connectionFrom('NONE', false)).toBe('none');
    expect(connectionFrom('WIFI', false)).toBe('none');
    for (const type of ['UNKNOWN', 'ETHERNET', 'VPN', 'BLUETOOTH', 'WIMAX', 'OTHER', undefined]) {
      expect(connectionFrom(type, true)).toBe('unknown');
    }
  });

  it('holds only audio, only with the switch on, only off WiFi', () => {
    const on = { connection: 'mobile' as const, wifiOnlyAudio: true };
    expect(heldForWifi('voice_note', on)).toBe(true);
    expect(heldForWifi('recording', on)).toBe(true);
    for (const entity of [
      'check_in',
      'check_out',
      'consent_record',
      'call_report',
      'sample_and_input',
      'visit',
      'work_day',
      'adverse_event',
    ] as const) {
      expect(heldForWifi(entity, on)).toBe(false);
    }
    expect(heldForWifi('voice_note', { ...on, wifiOnlyAudio: false })).toBe(false);
    expect(heldForWifi('voice_note', { ...on, connection: 'wifi' })).toBe(false);
  });
});
