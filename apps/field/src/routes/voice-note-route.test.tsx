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
const mockRecorder = {
  uri: null as string | null,
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
};
const mockRecorderState = { isRecording: false, durationMillis: 0 };
jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: () => mockRequestPermissions() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: () => Promise.resolve(),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => mockRecorderState,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: VISIT }),
}));
jest.mock('../session', () => ({
  useSession: () => ({ session: { user: { id: 'b95aa032-bd5e-4bb8-8b37-44696c6d6cc1' } } }),
}));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

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

beforeEach(() => {
  mockFiles.clear();
  mockRequestPermissions.mockReset();
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockRecorder.uri = null;
  mockRecorderState.isRecording = false;
  mockStore.mockReturnValue(pulled([visit]));
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
  it('moves the recording into the signed-in rep’s folder and says it was not sent', async () => {
    await recordOne('one');
    await fireEvent.press(screen.getByText('Save this note'));
    await waitFor(() => {
      expect(screen.getByText(/Saved on this phone, in your notes/u)).toBeTruthy();
    });
    const kept = [...mockFiles];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(new RegExp(`^${DOC}voice-notes/${REP_A}/[0-9a-f-]+\\.m4a$`, 'u'));
    expect(screen.getByText(/It has not been sent/u)).toBeTruthy();
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
