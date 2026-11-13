import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import type { NetworkState } from 'expo-network';
import { File } from 'expo-file-system';
import type { SyncQueueItem } from '@fieldforce/core';
import { audioFolder } from '../capture/voice-note-files';
import { documentRoot } from '../capture/voice-note-fs';
import { readDataPrefs } from '../settings/data-prefs';
import { dataUseRecorder } from './data-use-store';
import { recordingUploadFrom, voiceNoteUploadFrom } from './voice-note-upload';
import { connectionFrom } from './upload-conditions';
import type { Connection, UploadDevice, UploadSnapshot, UploadUse } from './upload-conditions';

/**
 * `FE-W135` — the device half of `UploadConditions`: the network through `expo-network` (Expo's own
 * module, SDK 57), the switch through AsyncStorage. Kept thin, as `voice-note-device.ts` is; every
 * rule is in `upload-conditions.ts` and `outbox.ts`, where it is tested without a device. Bound once
 * at the app root (`bindUploadDevice` in `app/_layout.tsx`).
 *
 * **A network the phone cannot describe is `unknown`, never WiFi** -- so a failed read holds audio
 * rather than spending the MR's data plan on a guess.
 */
export const deviceConnection = async (): Promise<Connection> => {
  try {
    // `undefined` where the native module is absent (a test renderer): read as unknown.
    const state = (await getNetworkStateAsync()) as NetworkState | undefined;
    return connectionFrom(state?.type, state?.isConnected);
  } catch {
    return 'unknown';
  }
};

export const readDeviceConditions = async (): Promise<UploadSnapshot> => {
  const [connection, prefs] = await Promise.all([deviceConnection(), readDataPrefs()]);
  return { connection, wifiOnlyAudio: prefs.wifiOnlyAudio };
};

const record = dataUseRecorder();

export const recordDeviceUse = (use: UploadUse): Promise<void> => record(use);

/**
 * `FE-W136`. The size of the held audio files, read from the files themselves -- so "Send now" can
 * say what it will cost before the MR spends it. `null` when any one of them cannot be measured:
 * then the button names no figure rather than a smaller, wrong one.
 */
export const heldAudioBytes = (items: readonly SyncQueueItem[]): number | null => {
  try {
    let total = 0;
    for (const item of items) {
      const recording = item.entity === 'recording';
      const body = recording
        ? recordingUploadFrom(item.payload)
        : voiceNoteUploadFrom(item.payload);
      if (body === null) return null;
      const folder = audioFolder(
        documentRoot(),
        body.userId,
        recording ? 'recordings' : 'voice-notes',
      );
      const file = new File(`${folder}${encodeURIComponent(body.noteId)}.m4a`);
      if (!file.exists) return null;
      total += file.size;
    }
    return total;
  } catch {
    return null;
  }
};

/**
 * Calls back whenever the phone changes network, with the new one. Returns the unsubscribe. A phone
 * that cannot report changes gets a no-op: audio then goes on the next foreground, as before.
 */
export const onConnectionChange = (listener: (connection: Connection) => void): (() => void) => {
  try {
    const subscription = addNetworkStateListener((state) => {
      listener(connectionFrom(state.type, state.isConnected));
    });
    return () => {
      try {
        (subscription as { remove?: () => void } | undefined)?.remove?.();
      } catch {
        // Already gone.
      }
    };
  } catch {
    return () => undefined;
  }
};

/** What `app/_layout.tsx` binds with `bindUploadDevice`. */
export const deviceUpload: UploadDevice = {
  read: readDeviceConditions,
  recordUse: recordDeviceUse,
  onConnectionChange,
  heldAudioBytes,
};
