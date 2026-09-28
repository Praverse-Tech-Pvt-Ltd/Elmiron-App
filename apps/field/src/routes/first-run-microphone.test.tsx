import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';

/**
 * FE-D2 first run — A4 (microphone) where the design puts it: "Before your first visit".
 *
 * Operator ruling (28 September): the first time the rep OPENS a visit, if the microphone is not
 * already granted and A4 has not been answered, A4 is shown, then the rep is back on the visit.
 * "Turn on the microphone" requests RECORD_AUDIO; "I'll type my reports" requests nothing. Either
 * answer is remembered, and A4 never shows again. (FE-D7 4: the design's labels; until then they
 * were "Allow the microphone" and "Not now".)
 *
 * Until now A4 was built and unreachable: nothing navigated to it, and both of its buttons only
 * went back.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockStore = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: '55555555-5555-4555-8555-555555555501' }),
}));
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createCheckIn: jest.fn(), createCheckOut: jest.fn() }),
}));
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listConsentRecords: jest.fn(async () => Promise.resolve({ items: [] })),
    createRecording: jest.fn(),
  }),
}));
jest.mock('../capture/location', () => ({ takeFix: jest.fn() }));
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

import { setQueueOwner } from '../sync/async-storage-store';
import VisitRoute from '../../app/visit/[id]';
import MicrophoneRationale from '../../app/onboarding/microphone';

const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';

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

const spyOnCheck = () => jest.spyOn(PermissionsAndroid, 'check');
const spyOnRequest = () => jest.spyOn(PermissionsAndroid, 'request');
let check: ReturnType<typeof spyOnCheck>;
let request: ReturnType<typeof spyOnRequest>;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.replaceProperty(Platform, 'OS', 'android');
  check = spyOnCheck().mockResolvedValue(false);
  request = spyOnRequest().mockResolvedValue('granted');
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
    refresh: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  mockPush.mockReset();
  mockBack.mockReset();
});

describe('A4 — shown before the first visit', () => {
  it('opening a visit for the first time shows A4', async () => {
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/microphone');
    });
    // Showing it asks nothing: the screen is the rationale, the prompt waits for "Allow".
    expect(request).not.toHaveBeenCalled();
  });

  it('once A4 has been answered, a visit does not show it again', async () => {
    await render(<MicrophoneRationale />);
    await fireEvent.press(screen.getByText("I'll type my reports"));
    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    mockPush.mockReset();

    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);
    // Give the gate's check the same chance it had in the case above.
    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(0);
    });
    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/microphone');
  });

  it('a microphone already granted (asked inline earlier) does not show A4', async () => {
    check.mockResolvedValue(true);
    await render(<VisitRoute />);
    await screen.findByText(/Dr Asha Deshpande/u);
    await waitFor(() => {
      expect(check).toHaveBeenCalledWith(RECORD_AUDIO);
    });

    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/microphone');
  });
});

describe('A4 — its two answers', () => {
  it('"Turn on the microphone" requests RECORD_AUDIO, and nothing else, then goes back', async () => {
    await render(<MicrophoneRationale />);

    await fireEvent.press(screen.getByText('Turn on the microphone'));

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(RECORD_AUDIO);
  });

  it('"I\'ll type my reports" requests nothing, then goes back', async () => {
    await render(<MicrophoneRationale />);

    await fireEvent.press(screen.getByText("I'll type my reports"));

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    expect(request).not.toHaveBeenCalled();
  });
});
