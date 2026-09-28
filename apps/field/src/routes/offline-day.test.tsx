import { describe, expect, it, jest } from '@jest/globals';
// Types only, and erased: nothing here is loaded at the top of the file. Every runtime module is
// `require`d inside `launch()`, after the registry has been emptied.
import type * as ReactModule from 'react';
import type * as RtlModule from '@testing-library/react-native/pure';
import type * as CoreModule from '@fieldforce/core';
import type * as VisitRouteModule from '../../app/visit/[id]';
import type * as QueueModule from '../sync/async-storage-store';
import type * as OutboxModule from '../sync/outbox';
import type { OutboxWriteClient } from '../sync/push-client';

/**
 * FE-D1 — a rep's offline day, from the real check-in screen, across process death.
 *
 * ---
 * **WHAT THIS ESTABLISHES, AND WHAT IT DOES NOT. Read this before citing the test.**
 *
 * It establishes: **a write that `sendOrQueue` has QUEUED survives process death and is flushed
 * exactly once, under the idempotency key minted when the rep pressed the button.** The writes
 * are produced by pressing the real buttons on `app/visit/[id].tsx`, not by a reducer call. Death
 * is `jest.resetModules()`: every module's memory is discarded, including the queue owner, the
 * reducer's state and the stock AsyncStorage mock (whose data lives INSIDE its module). The only
 * thing that survives is `mockDisk` below, which stands in for SQLite-backed AsyncStorage. After
 * each death, the next launch rebuilds from that disk and nothing else.
 *
 * It does NOT establish: **"no write is ever lost."** The screen sends FIRST and queues only when
 * the send gets no answer (`sendOrQueue`, `outbox.ts:323`). If the process dies DURING the send,
 * before either the success branch or the catch-block enqueue runs, nothing is on disk and the
 * server may or may not hold the write. That in-flight window is real, it is not exercised here,
 * and this test cannot see it: every send below has already failed before death. The window is
 * accepted for now as a ruling (`.ai-collab/decisions.md`, FE-D1). If enqueue-first is ever
 * adopted, it is all six writing screens in one pass.
 *
 * It also does not establish: that the SERVER dedupes (it does, `on conflict (id) do nothing`,
 * but the fake server here deliberately does not, so a client double-send would be counted); that
 * any of this holds on a device; or anything about an interrupted AsyncStorage write. The whole
 * queue is ONE value under ONE key, so a torn write there is the entire queue, not one item.
 * ---
 *
 * Negative control, run by hand and recorded in `PROJECT-OVERVIEW.md` (FE-D1): replacing the
 * `sendOrQueue` call in the check-in handler with a bare send turns this test red.
 */

const REP = '22222222-2222-4222-8222-222222222202';
const QUEUE_KEY = `sync.queue.v1.${REP}`;

/** The disk. Test-scope, so `jest.resetModules()` cannot reach it — the one survivor of death. */
const mockDisk = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: (key: string) => Promise.resolve(mockDisk.get(key) ?? null),
    setItem: (key: string, value: string) => {
      mockDisk.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      mockDisk.delete(key);
      return Promise.resolve();
    },
    multiRemove: (keys: readonly string[]) => {
      for (const key of keys) mockDisk.delete(key);
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve([...mockDisk.keys()]),
    clear: () => {
      mockDisk.clear();
      return Promise.resolve();
    },
  };
  return { __esModule: true, default: api, ...api };
});

// No signal all day: every send the SCREEN makes gets no answer.
const mockCreateCheckIn = jest.fn<(body: { id: string }) => Promise<unknown>>();
const mockCreateCheckOut = jest.fn<(body: { id: string }) => Promise<unknown>>();
const mockStore = jest.fn();
let mockVisitId = '';

jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({
    createCheckIn: mockCreateCheckIn,
    createCheckOut: mockCreateCheckOut,
  }),
}));
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listConsentRecords: jest.fn(async () => Promise.resolve({ items: [] })),
    createRecording: jest.fn(),
  }),
}));
// The shape the real `takeFix` returns (`location.ts:79-87`), `capturedAt` included. It becomes
// the request's `occurredAt`, and a queued row without one is refused at replay as unreadable.
// `visit-route.test.tsx` omits it; that suite never replays a row, so it never needed it.
jest.mock('../capture/location', () => ({
  takeFix: jest.fn(async () =>
    Promise.resolve({
      kind: 'fix',
      coordinates: {
        latitude: 18.5204,
        longitude: 73.8567,
        accuracyMetres: 8,
        capturedAt: '2026-09-11T05:30:00.000Z',
      },
    }),
  ),
}));
jest.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(),
    getRecordingPermissionsAsync: jest.fn(async () => Promise.resolve({ granted: false })),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockVisitId }),
}));

const DOCTOR_ID = '55555555-5555-4555-8555-5555555555bb';
const VISIT_A = '55555555-5555-4555-8555-555555555501';
const VISIT_B = '55555555-5555-4555-8555-555555555502';

/** Plain data, built once. Schemas are parsed per launch, from that launch's modules. */
const visitRow = (id: string, scheduledFor: string) => ({
  id,
  mrId: '55555555-5555-4555-8555-5555555555aa',
  doctorId: DOCTOR_ID,
  beatPlanId: null,
  clinicAddressId: null,
  status: 'planned',
  notMetReason: null,
  scheduledFor,
  startedAt: null,
  completedAt: null,
  receivedAt: '2026-09-11T08:00:00+05:30',
  createdAt: '2026-09-11T08:00:00+05:30',
  updatedAt: '2026-09-11T08:00:00+05:30',
});

const doctorRow = {
  id: DOCTOR_ID,
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: 'Urologist',
  qualification: null,
  territoryId: '55555555-5555-4555-8555-5555555555cc',
  assignedMrId: null,
  clinicAddresses: [],
  isActive: true,
  createdAt: '2026-09-01T08:00:00+05:30',
  updatedAt: '2026-09-01T08:00:00+05:30',
};

interface DiskRow {
  readonly id: string;
  readonly entity: string;
  readonly status: string;
  readonly payload: Record<string, unknown>;
}

/** What is on the disk right now. Read-only: the test never writes the queue itself. */
const onDisk = (): readonly DiskRow[] => {
  const raw = mockDisk.get(QUEUE_KEY);
  if (raw === undefined) return [];
  return (JSON.parse(raw) as { items: DiskRow[] }).items;
};

/**
 * A process start. Everything is loaded fresh from a registry that has just been emptied, so
 * no module memory from the previous launch can answer for the disk.
 */
const launch = () => {
  jest.resetModules();
  // `require`, not `import()`: jest-expo's transform leaves a dynamic import to Node, which
  // refuses it without `--experimental-vm-modules`. `require` goes through jest's registry,
  // which is the registry `resetModules` just emptied — the point of the exercise.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react') as typeof ReactModule;
  const rtl = require('@testing-library/react-native/pure') as typeof RtlModule;
  const core = require('@fieldforce/core') as typeof CoreModule;
  const queue = require('../sync/async-storage-store') as typeof QueueModule;
  const outbox = require('../sync/outbox') as typeof OutboxModule;
  const VisitRoute = (require('../../app/visit/[id]') as typeof VisitRouteModule).default;
  /* eslint-enable @typescript-eslint/no-require-imports */
  // The `pure` entry does not register cleanup (which would throw inside a test body) and so
  // does not set this either; the default entry does both.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // `SessionProvider` does this on every start from the stored session.
  queue.setQueueOwner(REP);
  mockStore.mockReturnValue({
    store: {
      visit: new Map([
        [VISIT_A, core.VisitSchema.parse(visitRow(VISIT_A, '2026-09-11T11:00:00+05:30'))],
        [VISIT_B, core.VisitSchema.parse(visitRow(VISIT_B, '2026-09-11T15:00:00+05:30'))],
      ]),
      doctor: new Map([[DOCTOR_ID, core.DoctorSchema.parse(doctorRow)]]),
      beat_plan: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
    },
    // Offline: the pull failed, the phone still holds the day's visits (FE-W62).
    status: 'failed',
    notice: null,
    failure: { kind: 'unreachable' },
    resynced: false,
    removals: [],
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    today: '2026-09-11',
    serverTime: '2026-09-11T08:00:00+05:30',
    refresh: jest.fn(),
  });

  const open = async (visitId: string) => {
    mockVisitId = visitId;
    const view = await rtl.render(React.createElement(VisitRoute));
    await view.findByText(/Dr Asha Deshpande/u);
    return view;
  };

  return { rtl, open, flushOutbox: outbox.flushOutbox };
};

/** Press a real button, and wait until the id the screen minted for it is on the disk. */
const pressAndPersist = async (
  rtl: ReturnType<typeof launch>['rtl'],
  view: Awaited<ReturnType<ReturnType<typeof launch>['open']>>,
  label: string,
  attempts: typeof mockCreateCheckIn,
): Promise<string> => {
  const before = attempts.mock.calls.length;
  await rtl.fireEvent.press(await view.findByText(label));
  await rtl.waitFor(() => {
    expect(attempts.mock.calls.length).toBe(before + 1);
  });
  const minted = attempts.mock.calls[before]?.[0].id ?? '';
  expect(minted).not.toBe('');
  // The core claim, asserted at the moment it must first hold: the work is on disk.
  await rtl.waitFor(() => {
    expect(onDisk().map((row) => row.id)).toContain(minted);
  });
  return minted;
};

/** Everything a check-in / check-out may carry. No prescribing or patient data can fit. */
const PAYLOAD_KEYS = ['__queueEntity', 'coordinates', 'id', 'occurredAt', 'source', 'visitId'];
const COORDINATE_KEYS = ['accuracyMetres', 'capturedAt', 'latitude', 'longitude'];

describe('FE-D1 — an offline day on the check-in screen survives process death', () => {
  it('queued writes rebuild from disk after death and flush exactly once, by the id minted at press', async () => {
    mockDisk.clear();
    mockCreateCheckIn.mockReset();
    mockCreateCheckOut.mockReset();
    const noSignal = () => Promise.reject(new Error('Network request failed'));
    mockCreateCheckIn.mockImplementation(noSignal);
    mockCreateCheckOut.mockImplementation(noSignal);

    // ---- Morning. Visit A: arrive, leave. No signal. ----
    const morning = launch();
    let view = await morning.open(VISIT_A);
    const inA = await pressAndPersist(morning.rtl, view, 'I am here — check in', mockCreateCheckIn);
    const outA = await pressAndPersist(
      morning.rtl,
      view,
      'Leaving — check out',
      mockCreateCheckOut,
    );
    await view.unmount();

    // ---- Android kills the app. ----
    // ---- Afternoon. A fresh process; Visit A's stage must come from the disk alone. ----
    const afternoon = launch();
    view = await afternoon.open(VISIT_A);
    // Rebuilt from persistence: both of A's writes are known, so neither action is offered again.
    // Were the queue lost, the screen would offer "I am here" and the rep would press it twice.
    expect(view.queryByText('I am here — check in')).toBeNull();
    expect(view.queryByText('Leaving — check out')).toBeNull();
    await view.unmount();

    view = await afternoon.open(VISIT_B);
    const inB = await pressAndPersist(
      afternoon.rtl,
      view,
      'I am here — check in',
      mockCreateCheckIn,
    );
    const outB = await pressAndPersist(
      afternoon.rtl,
      view,
      'Leaving — check out',
      mockCreateCheckOut,
    );
    await view.unmount();

    // ---- Killed again. ----
    // ---- Evening. Signal is back. A fresh process flushes what the disk holds. ----
    const minted = [inA, outA, inB, outB];
    expect(new Set(minted).size).toBe(4);

    const onDiskBeforeFlush = onDisk();
    expect(onDiskBeforeFlush.map((row) => [row.id, row.entity, row.status])).toEqual([
      [inA, 'check_in', 'queued'],
      [outA, 'check_out', 'queued'],
      [inB, 'check_in', 'queued'],
      [outB, 'check_out', 'queued'],
    ]);
    // Legal constraint, not style: the stored payload is a visit id, a position and a time.
    for (const row of onDiskBeforeFlush) {
      expect(Object.keys(row.payload).sort()).toEqual(PAYLOAD_KEYS);
      expect(Object.keys(row.payload['coordinates'] as object).sort()).toEqual(COORDINATE_KEYS);
    }

    const received: Array<[string, string]> = [];
    const server = {
      createCheckIn: (body: { id: string }) => {
        received.push(['check_in', body.id]);
        return Promise.resolve({ receivedAt: '2026-09-11T19:00:00.000+05:30' });
      },
      createCheckOut: (body: { id: string }) => {
        received.push(['check_out', body.id]);
        return Promise.resolve({ receivedAt: '2026-09-11T19:00:01.000+05:30' });
      },
    } as unknown as OutboxWriteClient;

    const evening = launch();
    const first = await evening.flushOutbox(server);
    expect(first).toEqual({ attempted: 4, sent: 4, stillQueued: 0 });

    // No lost writes, no duplicates, and each under the key minted at press — two deaths ago.
    expect(received).toEqual([
      ['check_in', inA],
      ['check_out', outA],
      ['check_in', inB],
      ['check_out', outB],
    ]);

    // A second flush in the same process, and another after one more death, send nothing.
    expect(await evening.flushOutbox(server)).toEqual({ attempted: 0, sent: 0, stillQueued: 0 });
    const night = launch();
    expect(await night.flushOutbox(server)).toEqual({ attempted: 0, sent: 0, stillQueued: 0 });
    expect(received).toHaveLength(4);
    expect(onDisk().every((row) => row.status !== 'queued')).toBe(true);
  });
});
