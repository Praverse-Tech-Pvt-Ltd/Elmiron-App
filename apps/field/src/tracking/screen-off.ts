/**
 * `FE-W207` — live location with the screen off: the pure half, tested without a phone.
 *
 * The native half is `screen-off-task.ts`: an Android location foreground service, started by the
 * tracker only while the app is on screen and only when `trackingState` is `active`. Its positions
 * arrive in a TaskManager task that knows nothing about the rep, the notice or the hours. **The task
 * hands every position to the SINK the live tracker installed, and to nothing else.** No sink means no
 * tracker is running in this process — the app was killed and Android re-created the task without
 * it — and then the right answer is to stop the service, never to send a position nobody decided on.
 */

/** The one name the service is registered under. */
export const SCREEN_OFF_TASK = 'fieldforce-live-location';

/** A position as the task receives it, reduced to what a ping carries. */
export interface ScreenOffFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number | null;
  /** The phone's own fix time, milliseconds since the epoch. */
  readonly timestampMs: number;
}

/** What the live tracker installs while it is running the service. */
export interface ScreenOffSink {
  readonly onFix: (fix: ScreenOffFix) => void;
}

let current: ScreenOffSink | null = null;

/** Installed by the tracker when it starts the service; `null` when it stops it. */
export const setScreenOffSink = (sink: ScreenOffSink | null): void => {
  current = sink;
};

export const screenOffSink = (): ScreenOffSink | null => current;

interface RawLocation {
  readonly coords?: {
    readonly latitude?: unknown;
    readonly longitude?: unknown;
    readonly accuracy?: unknown;
  };
  readonly timestamp?: unknown;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The positions in one task delivery, oldest first, each one checked: expo-location batches fixes
 * (`{ locations: [...] }`), and a malformed entry is dropped rather than sent as `NaN`.
 */
export const fixesFrom = (data: unknown): ScreenOffFix[] => {
  if (typeof data !== 'object' || data === null) return [];
  const locations = (data as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return [];
  const fixes: ScreenOffFix[] = [];
  for (const raw of locations as RawLocation[]) {
    const latitude = raw.coords?.latitude;
    const longitude = raw.coords?.longitude;
    const accuracy = raw.coords?.accuracy;
    const timestamp = raw.timestamp;
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude) || !isFiniteNumber(timestamp)) {
      continue;
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    fixes.push({
      latitude,
      longitude,
      accuracyM: isFiniteNumber(accuracy) ? accuracy : null,
      timestampMs: timestamp,
    });
  }
  return fixes.sort((a, b) => a.timestampMs - b.timestampMs);
};

export type TaskOutcome = 'delivered' | 'nothing' | 'stop';

/**
 * One task delivery. `stop` means the caller must stop the service: there is no tracker to decide
 * about these positions, so none of them is sent.
 */
export const deliver = (data: unknown, error: unknown, sink: ScreenOffSink | null): TaskOutcome => {
  if (sink === null) return 'stop';
  if (error !== null && error !== undefined) return 'nothing';
  const fixes = fixesFrom(data);
  if (fixes.length === 0) return 'nothing';
  // The tracker spaces them (`dueToSend`); the newest ones win when several arrive at once.
  for (const fix of fixes) sink.onFix(fix);
  return 'delivered';
};

/** Whether this phone runs the service at all: Android only, and only when the build says so. */
export const usesScreenOffService = (platform: string, enabled: boolean): boolean =>
  enabled && platform === 'android';
