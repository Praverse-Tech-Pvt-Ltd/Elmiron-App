import { afterEach, describe, expect, it, jest } from '@jest/globals';
// Types only, and erased: nothing here is loaded at the top of the file. Every runtime module is
// `require`d inside `launch()`, after the registry has been emptied.
import type * as ReactModule from 'react';
import type { PermissionsAndroid, Platform } from 'react-native';
import type * as RtlModule from '@testing-library/react-native/pure';
import type * as CoreModule from '@fieldforce/core';
import type * as VisitRouteModule from '../../app/visit/[id]';
import type * as MicrophoneModule from '../../app/onboarding/microphone';
import type * as QueueModule from '../sync/async-storage-store';
import type * as OutboxModule from '../sync/outbox';
import type { OutboxWriteClient } from '../sync/push-client';

/**
 * FE-D3 0 — the FE-D1 offline day, on ANDROID, through A4.
 *
 * Why this exists: the jest route suites run as iOS (jest-expo's default preset), and the
 * Android preset does not load in this repository (FE-D3 A1, an open item). This app is
 * Android-only, and since FE-D2 11 the first visit on Android passes through A4, the microphone
 * rationale. So the day the offline test proves had never been run the way it now happens on the
 * rep's phone.
 *
 * **Same day, same assertions as `offline-day.test.tsx`:** four writes from the real check-in
 * screen across two process deaths, then one flush — no lost writes, no duplicates, exact send
 * order. What it establishes and does not establish is exactly what that file's header says; read
 * it there.
 *
 * **What this adds, and it is the point:** `Platform.OS` is 'android' on every launch, so the A4
 * gate is live. Opening the first visit shows A4; the test answers it on the real A4 screen, A4
 * must RETURN to the visit (`router.back()`), and only then does the day carry on. A4's answer is
 * on the same disk as the queue, so it survives both deaths and must not appear again. Nothing is
 * pre-seeded to skip it.
 *
 * Negative control, run by hand and recorded in `PROJECT-OVERVIEW.md` (FE-D3): removing A4's
 * `router.back()` turns this test red.
 */

const REP = '22222222-2222-4222-8222-222222222202';
const QUEUE_KEY = `sync.queue.v1.${REP}`;
const A4 = '/onboarding/microphone';

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
// The router, observed: where the screens send the rep, and whether A4 sends them back.
const mockPush = jest.fn<(href: string) => void>();
const mockBack = jest.fn();
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
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack }),
  useLocalSearchParams: () => ({ id: mockVisitId }),
}));

const DOCTOR_ID = '55555555-5555-4555-8555-5555555555bb';
const VISIT_A = '55555555-5555-4555-8555-555555555501';
const VISIT_B = '55555555-5555-4555-8555-555555555502';

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

const onDisk = (): readonly DiskRow[] => {
  const raw = mockDisk.get(QUEUE_KEY);
  if (raw === undefined) return [];
  return (JSON.parse(raw) as { items: DiskRow[] }).items;
};

/** How many times the screens have sent the rep to A4, across every launch. */
const a4Shown = (): number => mockPush.mock.calls.filter(([href]) => href === A4).length;

/**
 * A process start, on an Android phone. Everything is loaded fresh from an emptied registry —
 * including `react-native`, so `Platform` and `PermissionsAndroid` are this launch's own and are
 * set up again here.
 */
const launch = () => {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react') as typeof ReactModule;
  const RN = require('react-native') as {
    Platform: typeof Platform;
    PermissionsAndroid: typeof PermissionsAndroid;
  };
  const rtl = require('@testing-library/react-native/pure') as typeof RtlModule;
  const core = require('@fieldforce/core') as typeof CoreModule;
  const queue = require('../sync/async-storage-store') as typeof QueueModule;
  const outbox = require('../sync/outbox') as typeof OutboxModule;
  const VisitRoute = (require('../../app/visit/[id]') as typeof VisitRouteModule).default;
  const MicrophoneRationale = (
    require('../../app/onboarding/microphone') as typeof MicrophoneModule
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports */
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // The phone. The same way the notification tests set it: the OS, and what Android answers.
  jest.replaceProperty(RN.Platform, 'OS', 'android');
  // RECORD_AUDIO has never been granted on this phone, so the A4 gate is decided by A4's answer.
  jest.spyOn(RN.PermissionsAndroid, 'check').mockResolvedValue(false);
  const request = jest.spyOn(RN.PermissionsAndroid, 'request').mockResolvedValue('granted');

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

  /**
   * A two-level stack standing in for expo-router: the visit underneath, and A4 on top when the
   * visit pushes it. `router.back()` takes A4 off. The visit stays mounted the whole time, as it
   * does on the phone — so "A4 returns to the visit" is observable as A4 leaving the tree while the
   * same visit screen is still there.
   */
  const Stack = (): ReturnType<typeof React.createElement> => {
    const [top, setTop] = React.useState<string | null>(null);
    mockPush.mockImplementation((href) => {
      if (href === A4) setTop(A4);
    });
    mockBack.mockImplementation(() => {
      setTop(null);
    });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(VisitRoute),
      top === A4 ? React.createElement(MicrophoneRationale) : null,
    );
  };

  const open = async (visitId: string) => {
    mockVisitId = visitId;
    const view = await rtl.render(React.createElement(Stack));
    await view.findByText(/Dr Asha Deshpande/u);
    return view;
  };

  /**
   * A4, gone through as the rep would: shown on top of the visit, answered on the real screen, and
   * it must send the rep BACK to the visit.
   */
  const throughA4 = async (view: Awaited<ReturnType<typeof open>>): Promise<void> => {
    await view.findByText('Turn on the microphone');
    const backsBefore = mockBack.mock.calls.length;
    await rtl.fireEvent.press(view.getByText('Turn on the microphone'));
    expect(request).toHaveBeenCalledWith('android.permission.RECORD_AUDIO');
    // The interaction under test: A4 returns the rep to the visit.
    await rtl.waitFor(() => {
      expect(mockBack.mock.calls.length).toBe(backsBefore + 1);
    });
    await rtl.waitFor(() => {
      expect(view.queryByText('Turn on the microphone')).toBeNull();
    });
    expect(view.getByText(/Dr Asha Deshpande/u)).toBeTruthy();
  };

  return { rtl, open, throughA4, flushOutbox: outbox.flushOutbox };
};

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
  await rtl.waitFor(() => {
    expect(onDisk().map((row) => row.id)).toContain(minted);
  });
  return minted;
};

const PAYLOAD_KEYS = ['__queueEntity', 'coordinates', 'id', 'occurredAt', 'source', 'visitId'];
const COORDINATE_KEYS = ['accuracyMetres', 'capturedAt', 'latitude', 'longitude'];

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FE-D3 0 — the offline day on Android, through A4', () => {
  it('A4 is answered and returns to the visit; queued writes survive death and flush exactly once', async () => {
    mockDisk.clear();
    mockCreateCheckIn.mockReset();
    mockCreateCheckOut.mockReset();
    mockPush.mockReset();
    mockBack.mockReset();
    const noSignal = () => Promise.reject(new Error('Network request failed'));
    mockCreateCheckIn.mockImplementation(noSignal);
    mockCreateCheckOut.mockImplementation(noSignal);

    // ---- Morning. The first visit of the rep's first day: A4 comes first. ----
    const morning = launch();
    let view = await morning.open(VISIT_A);
    await morning.throughA4(view);
    expect(a4Shown()).toBe(1);

    // Back on the visit: arrive, leave. No signal.
    const inA = await pressAndPersist(morning.rtl, view, 'I am here — check in', mockCreateCheckIn);
    const outA = await pressAndPersist(
      morning.rtl,
      view,
      'Leaving — check out',
      mockCreateCheckOut,
    );
    await view.unmount();

    // ---- Android kills the app. ----
    // ---- Afternoon. A fresh process: the queue AND A4's answer come from the disk alone. ----
    const afternoon = launch();
    view = await afternoon.open(VISIT_A);
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
    // A4 was answered before the first death. It is not shown again after it.
    expect(a4Shown()).toBe(1);

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

    // No lost writes, no duplicates, exact send order, each under the key minted at press.
    expect(received).toEqual([
      ['check_in', inA],
      ['check_out', outA],
      ['check_in', inB],
      ['check_out', outB],
    ]);

    expect(await evening.flushOutbox(server)).toEqual({ attempted: 0, sent: 0, stillQueued: 0 });
    const night = launch();
    expect(await night.flushOutbox(server)).toEqual({ attempted: 0, sent: 0, stillQueued: 0 });
    expect(received).toHaveLength(4);
    expect(onDisk().every((row) => row.status !== 'queued')).toBe(true);
  });
});
