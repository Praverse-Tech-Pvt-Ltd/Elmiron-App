import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
      coordinates: { latitude: 18.5204, longitude: 73.8567, accuracyMetres: 8 },
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
});
