import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

/**
 * MR-29 B3 — a failure must arrive with ITS OWN remedy, never another's.
 *
 * Found by pressing the button on the dev-client build with the mock server down. The
 * mount effect was ONE `async` block under ONE `.catch` titled *"Could not open the
 * microphone"*, and that block did two unrelated things: it opened the microphone, and it
 * fetched the visit and doctor over the network.
 *
 * So a network failure was reported as a microphone failure. The MR read *"Could not open
 * the microphone — fetch failed: java.io.IOException: unexpected end of stream on
 * http://127.0.0.1:4010/..."* and the action that sentence asks for — turn the microphone
 * on in Settings — would have done nothing, because the microphone was already on. It is
 * the rule `G-WRITE` closed on the refusal path, one screen along.
 *
 * Both directions are asserted, because a fix that simply renamed the single title would
 * pass one of these and fail the other.
 */

const mockRequestPermissions = jest.fn<() => Promise<{ granted: boolean }>>();
const mockSetAudioMode = jest.fn<() => Promise<void>>();
const mockListVisits = jest.fn<() => Promise<{ items: readonly unknown[] }>>();
const mockListDoctors = jest.fn<() => Promise<{ items: readonly unknown[] }>>();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: 'visit-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: () => mockRequestPermissions() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: () => mockSetAudioMode(),
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
}));

jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listVisits: () => mockListVisits(),
    listDoctors: () => mockListDoctors(),
  }),
}));

import VoiceNoteRoute from '../../app/voice-note/[visitId]';

/** Microphone fine, network fine, unless a case says otherwise. */
const base = (): void => {
  mockRequestPermissions.mockReset();
  mockSetAudioMode.mockReset();
  mockListVisits.mockReset();
  mockListDoctors.mockReset();
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockSetAudioMode.mockResolvedValue(undefined);
  mockListVisits.mockResolvedValue({ items: [] });
  mockListDoctors.mockResolvedValue({ items: [] });
};

describe('app/voice-note/[visitId].tsx — each failure carries its own remedy', () => {
  it('a NETWORK failure does not claim the microphone could not be opened', async () => {
    base();
    // The exact shape seen on the dev client: the mock server at :4010 was not running.
    mockListVisits.mockRejectedValue(
      new Error('fetch failed: unexpected end of stream on http://127.0.0.1:4010/visits'),
    );

    await render(<VoiceNoteRoute />);

    expect(await screen.findByText('Could not load this visit')).toBeTruthy();
    // The assertion that fails against the defect. Before the split this screen said
    // "Could not open the microphone" and offered a Settings remedy for a dead server.
    expect(screen.queryByText('Could not open the microphone')).toBeNull();
  });

  it('THE POSITIVE CONTROL: a MICROPHONE failure still says so', async () => {
    base();
    mockRequestPermissions.mockRejectedValue(new Error('audio session unavailable'));

    await render(<VoiceNoteRoute />);

    expect(await screen.findByText('Could not open the microphone')).toBeTruthy();
    // Without this the case above is satisfiable by deleting the microphone message
    // altogether, which would lose the one remedy that IS right when the mic is off.
    expect(screen.queryByText('Could not load this visit')).toBeNull();
  });
});

describe('app/voice-note/[visitId].tsx — FE-W54, a save that cannot happen is said', () => {
  it('says the note cannot be saved when the visit is not on this phone', async () => {
    // Measured on the Pixel 10: a real visit id is not in the mock's list, and "Save this note"
    // did nothing at all, with nothing said.
    base();
    mockListVisits.mockResolvedValue({ items: [] });

    await render(<VoiceNoteRoute />);

    expect(await screen.findByText('This note cannot be saved')).toBeTruthy();
    expect(screen.getByText(/The recording stays on this phone and is not sent/u)).toBeTruthy();
  });

  it('POSITIVE CONTROL: says nothing of the kind when the visit IS here', async () => {
    base();
    mockListVisits.mockResolvedValue({
      items: [
        {
          id: 'visit-1',
          mrId: 'm',
          doctorId: 'd',
          beatPlanId: null,
          clinicAddressId: null,
          status: 'in_progress',
          notMetReason: null,
          scheduledFor: null,
          startedAt: null,
          completedAt: null,
          visitDay: null,
          receivedAt: '2026-09-21T06:00:00.000Z',
          createdAt: '2026-09-21T06:00:00.000Z',
          updatedAt: '2026-09-21T06:00:00.000Z',
        },
      ],
    });

    await render(<VoiceNoteRoute />);

    expect(await screen.findByText('Hold to record')).toBeTruthy();
    expect(screen.queryByText('This note cannot be saved')).toBeNull();
  });
});
