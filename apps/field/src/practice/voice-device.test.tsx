import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

/**
 * `FE-W211` — the hands-free loop's STOPS, with the phone's audio replaced by doubles.
 *
 * `voice-device.ts` had no test: `practice-routes.test.tsx` replaces the whole module. What only a
 * handset can prove (that a microphone really opens, that a reply is really heard) is still not
 * proved here. What IS proved is the order of events around a stop, which needs no handset:
 * a Stop that lands while the loop is waiting on the phone must not be followed by the microphone
 * opening, a turn being sent, or a recording left on the phone.
 */

/** A promise the test finishes by hand -- the moment the phone takes to answer. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const mockRecorder = {
  isRecording: false,
  uri: null as string | null,
  prepareToRecordAsync: jest.fn<() => Promise<void>>(),
  record: jest.fn(() => {
    mockRecorder.isRecording = true;
    mockRecorder.uri = 'file:///cache/turn.m4a';
  }),
  stop: jest.fn(() => {
    mockRecorder.isRecording = false;
    return Promise.resolve();
  }),
};
const mockSetMode = jest.fn<() => Promise<void>>();
const mockPermission = jest.fn<() => Promise<{ granted: boolean }>>();
const mockDeleted: string[] = [];
const mockOnDisk = new Set<string>();

jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: () => mockPermission() },
  AudioQuality: { MEDIUM: 'medium' },
  IOSOutputFormat: { MPEG4AAC: 'aac' },
  createAudioPlayer: () => ({ addListener: jest.fn(), play: jest.fn(), remove: jest.fn() }),
  setAudioModeAsync: () => mockSetMode(),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({ isRecording: false, metering: -160 }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    readonly uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    get exists(): boolean {
      return mockOnDisk.has(this.uri);
    }
    delete(): void {
      mockOnDisk.delete(this.uri);
      mockDeleted.push(this.uri);
    }
    create(): void {
      mockOnDisk.add(this.uri);
    }
    write(): void {
      mockOnDisk.add(this.uri);
    }
    base64(): Promise<string> {
      return Promise.resolve('AAAA');
    }
  },
}));

import { useVoiceConversation } from './voice-device';

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.isRecording = false;
  mockRecorder.uri = null;
  mockDeleted.length = 0;
  mockOnDisk.clear();
  mockPermission.mockResolvedValue({ granted: true });
  mockSetMode.mockResolvedValue(undefined);
  mockRecorder.prepareToRecordAsync.mockResolvedValue(undefined);
});

describe('FE-W211 — a stop is not followed by an open microphone', () => {
  it('POSITIVE CONTROL: with no stop, Start opens the microphone', async () => {
    const send = jest.fn<(base64: string) => Promise<{ next: 'listen' }>>();
    const { result } = await renderHook(() => useVoiceConversation(send));
    await act(() => {
      result.current.start();
    });
    await flush();
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('listening');
  });

  it('Stop while the recorder is being prepared: the microphone never opens', async () => {
    const preparing = deferred<undefined>();
    mockRecorder.prepareToRecordAsync.mockReturnValue(preparing.promise);
    const send = jest.fn<(base64: string) => Promise<{ next: 'listen' }>>();
    const { result } = await renderHook(() => useVoiceConversation(send));
    await act(() => {
      result.current.start();
    });
    await flush();
    expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);

    await act(() => {
      result.current.stop();
    });
    preparing.resolve(undefined);
    await flush();

    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('off');
  });

  it('Stop while the permission sheet is up: nothing is prepared and nothing opens', async () => {
    const asking = deferred<{ granted: boolean }>();
    mockPermission.mockReturnValue(asking.promise);
    const send = jest.fn<(base64: string) => Promise<{ next: 'listen' }>>();
    const { result } = await renderHook(() => useVoiceConversation(send));
    await act(() => {
      result.current.start();
    });
    await act(() => {
      result.current.stop();
    });
    asking.resolve({ granted: true });
    await flush();

    expect(mockRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });

  it('Stop while listening deletes the recording it had started', async () => {
    const send = jest.fn<(base64: string) => Promise<{ next: 'listen' }>>();
    const { result } = await renderHook(() => useVoiceConversation(send));
    await act(() => {
      result.current.start();
    });
    await flush();
    mockOnDisk.add('file:///cache/turn.m4a');

    await act(() => {
      result.current.stop();
    });
    await flush();

    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(mockDeleted).toContain('file:///cache/turn.m4a');
    expect(send).not.toHaveBeenCalled();
  });

  it('leaving the screen deletes the recording, even when the recorder is already released', async () => {
    const send = jest.fn<(base64: string) => Promise<{ next: 'listen' }>>();
    const { result, unmount } = await renderHook(() => useVoiceConversation(send));
    await act(() => {
      result.current.start();
    });
    await flush();
    mockOnDisk.add('file:///cache/turn.m4a');
    // What expo-audio does on unmount, before this hook's own clean-up runs.
    mockRecorder.stop.mockImplementation(() => Promise.reject(new Error('recorder released')));

    await unmount();
    await flush();

    expect(mockDeleted).toContain('file:///cache/turn.m4a');
  });
});
