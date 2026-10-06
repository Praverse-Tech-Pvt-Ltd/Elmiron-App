import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';

/**
 * MR-28 B4 — defect 12, found by driving the samples cycle on the emulator.
 *
 * I pressed **"I am here — check in"**. The server accepted it — `visits.status` went to
 * `in_progress`, `sync_items` held one `accepted` `check_in` — and the screen stayed on
 * *"Not started"* with the same button under my thumb. So I pressed it again, and the
 * server recorded a **second** accepted `check_in`.
 *
 * The guard against exactly this already existed. `refreshQueue`'s own comment reads *"an
 * MR who presses 'I am here' with no signal and sees 'Not started' will press it again"* —
 * and it was wired into the QUEUED branch only. `witnessedStage(visit, queued)` is the
 * pulled store's visit plus the outbox; a SENT write is on neither, so re-reading the queue
 * changes nothing. **The guard held whenever the server was unreachable and failed whenever
 * it answered**, which is the ordinary case.
 *
 * Both branches are asserted here, because fixing one of a pair is how this happened.
 */

const mockCreateCheckIn = jest.fn<(body: unknown) => Promise<unknown>>();
const mockRefresh = jest.fn();
const mockStore = jest.fn();

jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createCheckIn: mockCreateCheckIn, createCheckOut: jest.fn() }),
}));
// The read client is still the mock for the recording/consent reads this screen makes;
// none of them are what these cases are about.
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listConsentRecords: jest.fn(async () => Promise.resolve({ items: [] })),
    createRecording: jest.fn(),
  }),
}));
// The position is read on the press. A real fix, so `blockedReason` lets the write through
// and the branch under test is reached.
jest.mock('../capture/location', () => ({
  takeFix: jest.fn(async () =>
    Promise.resolve({
      kind: 'fix',
      // `capturedAt` as a real fix carries it. Without it the QUEUED payload cannot be read back
      // on a flush (W2-B A found this: the flush blocked the item as unreadable and sent nothing).
      coordinates: {
        latitude: 18.5204,
        longitude: 73.8567,
        accuracyMetres: 8,
        capturedAt: '2026-09-11T12:00:00+05:30',
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
  useLocalSearchParams: () => ({ id: '55555555-5555-4555-8555-555555555501' }),
}));

import { setQueueOwner } from '../sync/async-storage-store';
import { SyncPushRefusal } from '../sync/push-client';
import type { OutboxWriteClient } from '../sync/push-client';
import { flushOutbox } from '../sync/outbox';
import { CHECK_IN_APPROXIMATE, CHECK_IN_OUTSIDE } from '../capture/visit';
import VisitRoute from '../../app/visit/[id]';

const visit = VisitSchema.parse({
  id: '55555555-5555-4555-8555-555555555501',
  mrId: '55555555-5555-4555-8555-5555555555aa',
  doctorId: '55555555-5555-4555-8555-5555555555bb',
  beatPlanId: null,
  clinicAddressId: null,
  status: 'planned',
  notMetReason: null,
  scheduledFor: '2026-09-11T13:00:00+05:30',
  startedAt: null,
  completedAt: null,
  receivedAt: '2026-09-11T08:00:00+05:30',
  createdAt: '2026-09-11T08:00:00+05:30',
  updatedAt: '2026-09-11T08:00:00+05:30',
});

const doctor = DoctorSchema.parse({
  id: '55555555-5555-4555-8555-5555555555bb',
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
});

const loaded = (): void => {
  // MR-49 / FE-W61. A queued write belongs to a signed-in MR; with no owner nothing can queue.
  setQueueOwner('22222222-2222-4222-8222-222222222202');
  mockStore.mockReturnValue({
    store: {
      visit: new Map([[visit.id, visit]]),
      doctor: new Map([[doctor.id, doctor]]),
      beat_plan: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
    },
    status: 'ready',
    notice: null,
    failure: null,
    resynced: false,
    removals: [],
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    today: '2026-09-11',
    serverTime: '2026-09-11T12:00:00+05:30',
    refresh: mockRefresh,
  });
  mockCreateCheckIn.mockClear();
  mockRefresh.mockClear();
};

/**
 * MR-49 / `FE-W62`. Offline, with the visit in the store, the screen showed only "Could not
 * load this visit" and no check-in -- measured on the Pixel 10. A failed background refresh
 * leaves the data STALE, not absent.
 */
describe('app/visit/[id].tsx — FE-W62, a failed refresh does not hide a visit the phone holds', () => {
  const offline = (store: Record<string, unknown> | null = null): void => {
    loaded();
    const held = mockStore() as Record<string, unknown>;
    mockStore.mockReturnValue({
      ...held,
      ...(store === null ? {} : { store: { ...(held['store'] as object), ...store } }),
      status: 'failed',
      failure: { kind: 'unreachable' },
    });
  };

  it('still offers check-in when the pull failed but the visit is on the phone', async () => {
    offline();
    await render(<VisitRoute />);
    expect(await screen.findByText('I am here — check in')).toBeTruthy();
    expect(screen.queryByText('Could not load this visit')).toBeNull();
  });

  it('POSITIVE CONTROL: says it could not load when the visit is NOT on the phone', async () => {
    offline({ visit: new Map() });
    await render(<VisitRoute />);
    expect(await screen.findByText('Could not load this visit')).toBeTruthy();
    expect(screen.queryByText('I am here — check in')).toBeNull();
  });
});

/**
 * MR-50 E2 / `FE-W64`. By direct link, the screen drew a visit the phone does not hold —
 * "This visit · Not started · I am here — check in" — seen on the Pixel 10 in MR-49.
 */
describe('app/visit/[id].tsx — FE-W64, a visit the phone does not hold is said to be absent', () => {
  const without = (status: string): void => {
    loaded();
    const held = mockStore() as Record<string, unknown>;
    mockStore.mockReturnValue({
      ...held,
      store: { ...(held['store'] as object), visit: new Map() },
      status,
    });
  };

  it('says the visit is not on this phone once the pull has settled without it', async () => {
    without('ready');
    await render(<VisitRoute />);
    expect(await screen.findByText('This visit is not on this phone')).toBeTruthy();
    expect(screen.queryByText('I am here — check in')).toBeNull();
  });

  it('POSITIVE CONTROL: claims nothing while the pull is still loading', async () => {
    without('loading');
    await render(<VisitRoute />);
    expect(screen.queryByText('This visit is not on this phone')).toBeNull();
  });
});

describe('app/visit/[id].tsx — defect 12, the stage after a SENT check-in', () => {
  it('asks the SERVER again once the check-in has been accepted', async () => {
    // The server now holds a visit this screen's store says is `planned`. Only the server
    // can say what stage it is in -- MR-02's constraint -- so the screen re-pulls rather
    // than deciding for itself that the stage has moved.
    loaded();
    mockCreateCheckIn.mockResolvedValue({});
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);

    await fireEvent.press(screen.getByText('I am here — check in'));

    await waitFor(() => {
      expect(mockCreateCheckIn).toHaveBeenCalledTimes(1);
    });
    // The assertion the defect fails. Without it the screen re-reads a queue this write
    // never entered and nothing on it changes.
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('does NOT re-pull when the write was QUEUED — that branch already worked', async () => {
    // The other side, and the reason this is two cases. A queued write DOES change
    // `witnessedStage`, because the queue is the other half of it, and re-pulling would
    // ask an unreachable server a question it cannot answer. The message the MR gets is
    // the assertion that this branch is the one that ran.
    loaded();
    mockCreateCheckIn.mockRejectedValue(new Error('Network request failed'));
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);

    await fireEvent.press(screen.getByText('I am here — check in'));

    expect(await screen.findByText(/Saved on this phone/u)).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('MR-50 E1 / FE-W63: names the queued write a CHECK-IN, though the stage has moved on', async () => {
    // Seen on the Pixel 10 (MR-49 A1): the banner took its title from the stage at render, and a
    // queued check-in moves the stage to `during`, so it read "This check-out cannot be sent yet".
    // The case above queued a check-in for this same visit in the shared in-memory storage; start
    // from an empty queue so the stage begins at `before`, as it did on the device.
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockRejectedValue(new Error('Network request failed'));
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);

    await fireEvent.press(screen.getByText('I am here — check in'));

    expect(await screen.findByText('This check-in cannot be sent yet')).toBeTruthy();
    expect(screen.queryByText('This check-out cannot be sent yet')).toBeNull();
    // Not vacuous: the stage really did move — the check-out action is now what is offered.
    expect(screen.getByText('Leaving — check out')).toBeTruthy();
  });
});

/**
 * FE-D2 6 — an action's failure is shown, and then the screen is given back.
 *
 * Every press outcome on this screen (refused, not saved, recording failed) went into the one
 * `failure` that `VisitScreen` renders INSTEAD of the visit, and nothing ever set it back to null.
 * A rep whose check-in was refused was left looking at a banner, with no button, until they left
 * the screen — and could not try again, check out, or record.
 */
describe('app/visit/[id].tsx — FE-D2 6, a refused press does not take the screen away', () => {
  const refused = (): SyncPushRefusal =>
    new SyncPushRefusal({
      message: 'You were outside your shift window.',
      sqlState: '45007',
      rejectionCode: null,
      deadLettered: false,
    });

  it('shows the refusal and keeps the check-in button', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockRejectedValue(refused());
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);

    await fireEvent.press(screen.getByText('I am here — check in'));

    expect(await screen.findByText('That was refused')).toBeTruthy();
    expect(screen.getByText('I am here — check in')).toBeTruthy();
    expect(screen.getByText(/Dr Asha Deshpande/u)).toBeTruthy();
  });

  it('the next press clears it', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockRejectedValue(refused());
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);
    await fireEvent.press(screen.getByText('I am here — check in'));
    await screen.findByText('That was refused');

    mockCreateCheckIn.mockResolvedValue({});
    await fireEvent.press(screen.getByText('I am here — check in'));

    await waitFor(() => {
      expect(mockCreateCheckIn).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText('That was refused')).toBeNull();
  });
});

/**
 * W2-B A / `BE-W147` — `BE-C5`: the rep is TOLD when the clinic could not be confirmed.
 *
 * On 5 October the emulator checked in 13,353 km from the clinic, the server stored `outside`, and the
 * screen said "You are checked in" and nothing else. The ruling to tell the rep had stood since 29
 * September.
 *
 * **Both arrival paths, and both sides of each.** Sent at once, the warning rides the send's answer;
 * queued, it arrives on a later flush and must be read back from the queue. And on each, an ordinary
 * check-in must say NOTHING — the half a careless test skips, and the half that decides whether a rep
 * learns to read the line or to ignore it.
 */
describe('app/visit/[id].tsx — BE-C5, a check-in the clinic could not confirm says so', () => {
  const pressCheckIn = async (): Promise<void> => {
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);
    await fireEvent.press(screen.getByText('I am here — check in'));
  };

  it('SENT: an outside verdict shows the one line', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockResolvedValue({
      receivedAt: '2026-09-11T12:01:00+05:30',
      warnings: ['check_in_outside_geofence'],
    });
    await pressCheckIn();
    expect(await screen.findByText(CHECK_IN_OUTSIDE)).toBeTruthy();
  });

  it('SENT: an ordinary check-in shows NO line', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockResolvedValue({ receivedAt: '2026-09-11T12:01:00+05:30', warnings: [] });
    await pressCheckIn();
    // Wait for the branch that WOULD have set it, so the absence below is not just "too early".
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(screen.queryByText(CHECK_IN_OUTSIDE)).toBeNull();
    expect(screen.queryByText(CHECK_IN_APPROXIMATE)).toBeNull();
  });

  it('SENT: a coarse fix says "too rough", not "away" — BE-C2, the verdict was a coin', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockResolvedValue({
      receivedAt: '2026-09-11T12:01:00+05:30',
      warnings: ['check_in_outside_geofence', 'check_in_location_approximate'],
    });
    await pressCheckIn();
    expect(await screen.findByText(CHECK_IN_APPROXIMATE)).toBeTruthy();
    expect(screen.queryByText(CHECK_IN_OUTSIDE)).toBeNull();
  });

  const flushWith = async (answer: unknown): Promise<void> => {
    const client = { createCheckIn: jest.fn(async () => Promise.resolve(answer)) };
    const result = await flushOutbox(client as unknown as OutboxWriteClient);
    // The control both QUEUED cases rest on: the flush really sent the item. Without it, a flush
    // that blocked the item (as the first draft's fixture made it do) passes the NO-line case.
    expect(result.sent).toBe(1);
  };

  it('QUEUED: the warning from a LATER flush is shown when the rep comes back to the visit', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockRejectedValue(new Error('Network request failed'));
    await pressCheckIn();
    await screen.findByText(/Saved on this phone/u);
    expect(screen.queryByText(CHECK_IN_OUTSIDE)).toBeNull();

    await flushWith({
      receivedAt: '2026-09-11T12:05:00+05:30',
      warnings: ['check_in_outside_geofence'],
    });
    await render(<VisitRoute />);
    expect(await screen.findByText(CHECK_IN_OUTSIDE)).toBeTruthy();
  });

  it('QUEUED: an ordinary flushed check-in shows NO line', async () => {
    await AsyncStorage.clear();
    loaded();
    mockCreateCheckIn.mockRejectedValue(new Error('Network request failed'));
    await pressCheckIn();
    await screen.findByText(/Saved on this phone/u);

    await flushWith({ receivedAt: '2026-09-11T12:05:00+05:30', warnings: [] });
    await render(<VisitRoute />);
    // Wait for the queue to be read (the stage moves to `during` from it), so the absence below is
    // an answer and not "too early".
    await screen.findByText('Leaving — check out');
    expect(screen.queryByText(CHECK_IN_OUTSIDE)).toBeNull();
    expect(screen.queryByText(CHECK_IN_APPROXIMATE)).toBeNull();
  });
});
