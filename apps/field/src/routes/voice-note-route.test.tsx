import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * `app/voice-note/[visitId].tsx` — each failure carries its own remedy (MR-29), and MR-50 D:
 * the note is saved from a REAL visit (`FE-W54`), kept in the signed-in rep's folder, and audio
 * that was not kept is deleted (`C9`).
 *
 * The file system is an in-memory set standing in for `voice-note-fs.ts`; the emulator run proves
 * the same against real files (PROJECT-OVERVIEW → MR-50 D).
 */

const DOC = 'file:///data/user/0/app/files/';
const CACHE = 'file:///data/user/0/app/cache/';
const REP_A = 'b95aa032-bd5e-4bb8-8b37-44696c6d6cc1';
const VISIT = '66666666-6666-4666-8666-666666666601';
const recorderFile = (id: string): string => `${CACHE}Audio/recording-${id}.m4a`;

const mockFiles = new Set<string>();
jest.mock('../capture/voice-note-fs', () => ({
  documentRoot: () => DOC,
  cacheRoot: () => CACHE,
  expoNoteFileSystem: {
    exists: (uri: string) => mockFiles.has(uri),
    remove: (uri: string) => {
      mockFiles.delete(uri);
    },
    move: (from: string, to: string) => {
      // As the device does: moving a file that is not there fails.
      if (!mockFiles.has(from)) return Promise.reject(new Error(`no such file ${from}`));
      mockFiles.delete(from);
      mockFiles.add(to);
      return Promise.resolve();
    },
    list: (folder: string) =>
      [...mockFiles].filter((u) => u.startsWith(folder) && !u.slice(folder.length).includes('/')),
  },
}));

const mockRequestPermissions = jest.fn<() => Promise<{ granted: boolean }>>();
const mockGetPermissions = jest.fn<() => Promise<{ granted: boolean }>>();
const mockRecorder = {
  uri: null as string | null,
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
};
const mockRecorderState = { isRecording: false, durationMillis: 0 };
jest.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: () => mockRequestPermissions(),
    getRecordingPermissionsAsync: () => mockGetPermissions(),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: () => Promise.resolve(),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => mockRecorderState,
}));

jest.mock('expo-router', () => ({
  // `FE-W188`. The screen's Back control reads the router; nothing here presses it.
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ visitId: VISIT }),
}));
jest.mock('../session', () => ({
  useSession: () => ({ session: { user: { id: 'b95aa032-bd5e-4bb8-8b37-44696c6d6cc1' } } }),
}));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

// MR-51 D. The upload itself is `push-client.ts`'s, tested in `voice-note-upload.test.ts`; here
// only what the screen does with each outcome. Offline unless a test says otherwise.
const mockUpload = jest.fn<(body: Record<string, unknown>) => Promise<{ receivedAt: string }>>();
jest.mock('../sync/push-client', () => {
  const actual = jest.requireActual<Record<string, unknown>>('../sync/push-client');
  return { ...actual, createPushClient: () => ({ uploadVoiceNote: mockUpload }) };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking } from 'react-native';
import { setQueueOwner } from '../sync/async-storage-store';
import { bindUploadDevice } from '../sync/upload-conditions';

// `FE-W135`. The phone's network, as WiFi-only sees it -- bound as `app/_layout.tsx` binds the real
// one. On WiFi unless a test says otherwise, so the cases are about sending; the WiFi-only case
// below sets mobile data.
let connection: 'wifi' | 'mobile' = 'wifi';
bindUploadDevice({
  read: () => Promise.resolve({ connection, wifiOnlyAudio: true }),
  recordUse: () => Promise.resolve(),
  onConnectionChange: () => () => undefined,
  heldAudioBytes: () => null,
});
import type * as PushClient from '../sync/push-client';

type PushClientModule = typeof PushClient;

import VoiceNoteRoute from '../../app/voice-note/[visitId]';

const visit = {
  id: VISIT,
  mrId: REP_A,
  doctorId: '33333333-3333-4333-8333-333333333301',
  beatPlanId: null,
  clinicAddressId: null,
  status: 'in_progress',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-22T06:00:00.000Z',
  completedAt: null,
  visitDay: '2026-09-22',
  receivedAt: '2026-09-22T06:00:01.000Z',
  createdAt: '2026-09-22T06:00:00.000Z',
  updatedAt: '2026-09-22T06:00:01.000Z',
};

const pulled = (visits: readonly unknown[], status = 'ready') => ({
  store: {
    visit: new Map(visits.map((v) => [(v as { id: string }).id, v])),
    doctor: new Map(),
    beat_plan: new Map(),
    beat_plan_entry: new Map(),
    clinic_address: new Map(),
    consent_text_version: new Map(),
  },
  status,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  // The queue is per rep (MR-49); the real session names its owner, the mocked one does not.
  setQueueOwner(REP_A);
  mockUpload.mockReset();
  mockUpload.mockRejectedValue(new Error('Network request failed'));
  mockFiles.clear();
  mockRequestPermissions.mockReset();
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockGetPermissions.mockReset();
  mockGetPermissions.mockResolvedValue({ granted: false });
  mockRecorder.uri = null;
  mockRecorderState.isRecording = false;
  mockStore.mockReturnValue(pulled([visit]));
  connection = 'wifi';
});

/** Render mid-recording, release the hold, and wait until a note is captured. */
const recordOne = async (id: string) => {
  mockRecorderState.isRecording = true;
  mockRecorder.uri = recorderFile(id);
  const view = await render(<VoiceNoteRoute />);
  // The recorder writes its working file AFTER the screen opened -- as on the device. Written
  // before render, the mount-time sweep deleted it and the cases below passed without testing
  // anything: MR-50's own mutant (no discard on leaving) survived and showed it.
  mockFiles.add(recorderFile(id));
  await fireEvent(screen.getByLabelText('Hold to record your note'), 'pressOut');
  await screen.findByText('Save this note');
  return view;
};

/**
 * `FE-W198` — the microphone banner is about the rep's own note, and leads to Settings.
 *
 * It said "Turn it on in Settings if you want to record with the doctor's agreement" -- the
 * consultation recording's sentence, on the screen onboarding calls "yours". And it named Settings
 * with no way there (15 October re-check, screenshot 08a).
 */
describe('FE-W198 — the microphone is off', () => {
  it('says so about the rep’s own note, never the doctor’s agreement', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    await render(<VoiceNoteRoute />);
    expect(
      await screen.findByText(
        'The microphone is off for this app. Turn it on in Settings to record your note.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/agreement/u)).toBeNull();
  });

  it('"Open Settings" opens this app’s settings', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockRequestPermissions.mockResolvedValue({ granted: false });
    await render(<VoiceNoteRoute />);
    await fireEvent.press(await screen.findByText('Open Settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('back from Settings with it on, the banner goes and recording is offered', async () => {
    const listeners: ((state: string) => void)[] = [];
    const listen = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    mockGetPermissions.mockResolvedValue({ granted: true });
    await render(<VoiceNoteRoute />);
    await screen.findByText('Open Settings');

    for (const listener of listeners) listener('active');

    await waitFor(() => {
      expect(screen.queryByText('Open Settings')).toBeNull();
    });
    expect(mockGetPermissions).toHaveBeenCalled();
    listen.mockRestore();
  });

  it('POSITIVE CONTROL: with the microphone on there is no banner and no Settings action', async () => {
    await render(<VoiceNoteRoute />);
    await screen.findByLabelText('Hold to record your note');
    expect(screen.queryByText('Open Settings')).toBeNull();
  });
});

describe('each failure carries its own remedy', () => {
  it('a MICROPHONE failure says so', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('audio session unavailable'));
    await render(<VoiceNoteRoute />);
    expect(await screen.findByText('Could not open the microphone')).toBeTruthy();
  });

  it('says the note cannot be saved once the pull has settled WITHOUT the visit', async () => {
    mockStore.mockReturnValue(pulled([]));
    await render(<VoiceNoteRoute />);
    expect(await screen.findByText('This note cannot be saved')).toBeTruthy();
  });

  it('POSITIVE CONTROL: claims nothing while the pull is still loading', async () => {
    mockStore.mockReturnValue(pulled([], 'loading'));
    await render(<VoiceNoteRoute />);
    await screen.findByText('Hold to record');
    expect(screen.queryByText('This note cannot be saved')).toBeNull();
  });
});

describe('FE-W54 — Save keeps the note, from a REAL visit', () => {
  it('moves the recording into the signed-in rep’s folder; offline, says it will send later', async () => {
    await recordOne('one');
    await fireEvent.press(screen.getByText('Save this note'));
    await waitFor(() => {
      expect(screen.getByText(/It will send by itself when you have signal/u)).toBeTruthy();
    });
    const kept = [...mockFiles];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(new RegExp(`^${DOC}voice-notes/${REP_A}/[0-9a-f-]+\\.m4a$`, 'u'));
  });
});

describe('FE-W135 — on mobile data, with WiFi-only on (the default)', () => {
  it('keeps and queues the note WITHOUT trying, and says it goes on WiFi', async () => {
    connection = 'mobile';
    mockUpload.mockResolvedValue({ receivedAt: '2026-09-22T10:05:00Z' });
    await recordOne('wifi');
    await fireEvent.press(screen.getByText('Save this note'));
    await screen.findByText(/It will send by itself when this phone is on WiFi/u);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.queryByText(/when you have signal/u)).toBeNull();

    const keys = await AsyncStorage.getAllKeys();
    const raw = await AsyncStorage.getItem(keys.find((k) => k.includes(REP_A)) ?? '');
    const items = (JSON.parse(raw ?? '{}') as { items?: { entity: string }[] }).items ?? [];
    expect(items.map((i) => i.entity)).toEqual(['voice_note']);
  });
});

describe('MR-51 D — Save sends the note it kept', () => {
  it('sends the kept file’s note, for this visit and this rep', async () => {
    mockUpload.mockResolvedValue({ receivedAt: '2026-09-22T10:05:00Z' });
    await recordOne('five');
    await fireEvent.press(screen.getByText('Save this note'));
    await screen.findByText(/Sent\. The note has reached the company/u);

    const [body] = mockUpload.mock.calls[0] ?? [];
    const kept = [...mockFiles][0] ?? '';
    expect(body?.['visitId']).toBe(VISIT);
    expect(body?.['userId']).toBe(REP_A);
    // The note sent is the file kept: its name is the note id.
    expect(kept.endsWith(`/${String(body?.['noteId'])}.m4a`)).toBe(true);
  });

  it('offline, the note is queued in the rep’s own queue as a voice_note', async () => {
    await recordOne('six');
    await fireEvent.press(screen.getByText('Save this note'));
    await screen.findByText(/It will send by itself/u);

    const keys = await AsyncStorage.getAllKeys();
    const raw = await AsyncStorage.getItem(keys.find((k) => k.includes(REP_A)) ?? '');
    const items = (JSON.parse(raw ?? '{}') as { items?: { entity: string }[] }).items ?? [];
    expect(items.map((i) => i.entity)).toEqual(['voice_note']);
  });

  it('a refusal says so, and does not claim the note will send', async () => {
    const { SyncPushRefusal } = jest.requireActual<PushClientModule>('../sync/push-client');
    mockUpload.mockRejectedValue(
      new SyncPushRefusal({
        message: 'visit is not yours',
        sqlState: '42501',
        rejectionCode: null,
        deadLettered: false,
      }),
    );
    await recordOne('seven');
    await fireEvent.press(screen.getByText('Save this note'));
    // `FE-W197`. The remedy for 42501 and its reference -- never the server's own sentence.
    await screen.findByText(
      /the server refused to take it: Your account can’t open this\..*Reference: 42501\./u,
    );
    expect(screen.queryByText(/visit is not yours/u)).toBeNull();
    expect(screen.queryByText(/It will send by itself/u)).toBeNull();
  });
});

describe('D2 — audio that was not kept leaves the phone', () => {
  it('"Start again" deletes the unsaved recording', async () => {
    await recordOne('two');
    await fireEvent.press(screen.getByText('Start again'));
    expect(mockFiles.has(recorderFile('two'))).toBe(false);
  });

  it('leaving without saving deletes it', async () => {
    const view = await recordOne('three');
    await view.unmount();
    expect(mockFiles.has(recorderFile('three'))).toBe(false);
  });

  it('POSITIVE CONTROL: leaving AFTER saving keeps the note', async () => {
    const view = await recordOne('four');
    await fireEvent.press(screen.getByText('Save this note'));
    await screen.findByText(/Saved on this phone/u);
    await view.unmount();
    expect([...mockFiles].some((u) => u.startsWith(`${DOC}voice-notes/${REP_A}/`))).toBe(true);
  });

  it('sweeps recordings left in the cache when the screen opens', async () => {
    mockFiles.add(recorderFile('old-1'));
    mockFiles.add(recorderFile('old-2'));
    await render(<VoiceNoteRoute />);
    await screen.findByText('Hold to record');
    expect([...mockFiles]).toEqual([]);
  });
});

/**
 * FE-D2 6 — a note that could not be kept is said so, and the screen is given back.
 *
 * Start, stop and save failures went into the one `failure` that `VoiceNoteScreen` renders
 * INSTEAD of the recorder, and nothing cleared it: after "Your note was not saved" the rep had no
 * "Start again" and no way to record, short of leaving. (The microphone-open failure is not a
 * press and still replaces the screen: with no microphone there is nothing to give back.)
 */
describe('FE-D2 6 — a failed save does not take the recorder away', () => {
  it('shows the failure and keeps "Start again"', async () => {
    await recordOne('eight');
    // The recorder's file is gone before Save: keeping it fails, as it would on the device.
    mockFiles.delete(recorderFile('eight'));

    await fireEvent.press(screen.getByText('Save this note'));

    expect(await screen.findByText('Your note was not saved')).toBeTruthy();
    expect(screen.getByText('Start again')).toBeTruthy();
  });

  it('"Start again" clears it', async () => {
    await recordOne('nine');
    mockFiles.delete(recorderFile('nine'));
    await fireEvent.press(screen.getByText('Save this note'));
    await screen.findByText('Your note was not saved');

    await fireEvent.press(screen.getByText('Start again'));

    expect(screen.queryByText('Your note was not saved')).toBeNull();
  });
});
