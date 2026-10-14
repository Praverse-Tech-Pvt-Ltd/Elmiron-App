import type { SyncQueueItem } from '@fieldforce/core';

/**
 * `FE-W135` — what the outbox must know about the phone before it sends: which network it is on,
 * whether audio is allowed on that network, and where to count what it sent over mobile data.
 *
 * **A parameter, not an import**, for the reason `QueuePersistence` is one: the rules belong under
 * the node-side runner, and the network module is native. `deviceUploadConditions` below binds the
 * device lazily -- loading `expo-network` at import would break every logic test that imports the
 * outbox, as `../supabase` would (`voice-note-device.ts`).
 */

/**
 * The network, as far as this app needs to know it. **Only `wifi` lets audio go under WiFi-only.**
 * `unknown` covers everything the phone could not name or that is not plainly WiFi -- Ethernet, VPN,
 * Bluetooth, "other" -- because guessing WiFi on a metered link spends the MR's money, and guessing
 * mobile on an unmetered one only delays a recording.
 */
export type Connection = 'wifi' | 'mobile' | 'none' | 'unknown';

/** `expo-network`'s `NetworkStateType` values, mapped. Taken as strings so this file stays pure. */
export const connectionFrom = (type: string | undefined, isConnected?: boolean): Connection => {
  if (type === 'NONE' || isConnected === false) return 'none';
  if (type === 'WIFI') return 'wifi';
  if (type === 'CELLULAR') return 'mobile';
  return 'unknown';
};

export interface UploadSnapshot {
  readonly connection: Connection;
  /** The MR's switch (`settings/data-prefs.ts`). On by default. */
  readonly wifiOnlyAudio: boolean;
}

export interface UploadUse {
  /** Bytes this app sent for one accepted upload, over a connection that was not WiFi. */
  readonly bytes: number;
  /** The server's clock for that upload -- which decides the month it counts in. */
  readonly serverTime: string;
}

export interface UploadConditions {
  readonly read: () => Promise<UploadSnapshot>;
  /** Never throws: counting is a note, and a note must never cost a send. */
  readonly recordUse: (use: UploadUse) => Promise<void>;
}

/** The two kinds of saved audio. Everything else is small and never waits for WiFi. */
export const isAudio = (entity: SyncQueueItem['entity']): boolean =>
  entity === 'voice_note' || entity === 'recording';

/** Does WiFi-only hold this item right now? */
export const heldForWifi = (entity: SyncQueueItem['entity'], snapshot: UploadSnapshot): boolean =>
  isAudio(entity) && snapshot.wifiOnlyAudio && snapshot.connection !== 'wifi';

/**
 * `FE-W136`. The queue rows WiFi-only is holding right now -- for the queue screen's "Waiting for
 * WiFi" and the sync line's "N waiting for WiFi". Only `queued` rows: one in flight is being sent,
 * and a refused one is the server's answer, not a wait. `null` (not read yet) holds nothing, so no
 * screen claims a wait it has not checked.
 */
export const heldAudioIds = (
  items: readonly Pick<SyncQueueItem, 'id' | 'entity' | 'status'>[],
  snapshot: UploadSnapshot | null,
): readonly string[] =>
  snapshot === null
    ? []
    : items
        .filter((item) => item.status === 'queued' && heldForWifi(item.entity, snapshot))
        .map((item) => item.id);

/** Whether a send over this connection counts toward the month's mobile-data uploads. */
export const countsAsMobileData = (connection: Connection): boolean => connection !== 'wifi';

/**
 * The MR pressed "Send now" on the queue screen: audio may go over whatever this is, this once.
 * Counting is unchanged -- what goes over mobile data is still counted.
 */
export const sendingAudioAnyway = (base: UploadConditions): UploadConditions => ({
  read: async () => ({ ...(await base.read()), wifiOnlyAudio: false }),
  recordUse: base.recordUse,
});

/**
 * The device half: the two conditions, plus what the screens need from the same native modules --
 * a signal when the network changes, and the size of held audio files.
 */
export interface UploadDevice extends UploadConditions {
  /** Calls back on every network change. Returns the unsubscribe. */
  readonly onConnectionChange: (listener: (connection: Connection) => void) => () => void;
  /** Bytes of these audio rows' files, or null when any one cannot be measured. */
  readonly heldAudioBytes: (items: readonly SyncQueueItem[]) => number | null;
}

let bound: UploadDevice | null = null;

/**
 * Bound ONCE, at the app root (`app/_layout.tsx`), as `setQueueOwner` names the queue's owner. Not a
 * lazy `import()`: that is not transformed under jest, so no render test could ever have put the
 * phone on WiFi. A test binds a fake; nothing bound means the careful answer below.
 */
export const bindUploadDevice = (device: UploadDevice | null): void => {
  bound = device;
};

export const uploadDevice = (): UploadDevice | null => bound;

const CAREFUL: UploadSnapshot = { connection: 'unknown', wifiOnlyAudio: true };

/**
 * The device's answers. **With no device bound, or one that fails, the answer is the careful one:**
 * an unknown network with WiFi-only on, so audio waits and nothing else changes.
 */
export const deviceUploadConditions: UploadConditions = {
  read: async () => {
    if (bound === null) return CAREFUL;
    try {
      return await bound.read();
    } catch {
      return CAREFUL;
    }
  },
  recordUse: async (use) => {
    try {
      await bound?.recordUse(use);
    } catch {
      // Not counted. Nothing the MR did is affected.
    }
  },
};
