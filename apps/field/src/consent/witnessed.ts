import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncQueueItem } from '@fieldforce/core';
import { queueOwner } from '../sync/async-storage-store';

/**
 * MR-49 C — `FE-W55`, the third option: **what this phone witnessed, and nothing more.**
 *
 * The visit screen told an MR to "ask the doctor first … until they have answered on this phone"
 * after the doctor HAD answered on this phone (Pixel 10, MR-47). The pull carries no consent
 * records (MR-12 Q4), and the only read of the server's answer is audited per call — the decision
 * is to use neither. So this module keeps the one thing the device knows first-hand: that it
 * captured an answer, which answer, when, and under which queue item.
 *
 * It is a record of the device's own act, not a copy of the server's consent ledger, and it
 * decides nothing: recording is not enabled by it, and the screen says what was witnessed.
 *
 * **Scoped to the signed-in MR AND the visit** — the lesson of `FE-W61` (MR-49 A): one key per
 * user, and a previous MR's answer on this phone is not read. With no one signed in there is
 * nothing to read or write.
 */
export type WitnessedOutcome = 'consented' | 'declined' | 'not_asked';

export interface WitnessedConsent {
  readonly visitId: string;
  readonly outcome: WitnessedOutcome;
  /** The device's own instant — `captured_at` on the record it sent or queued. */
  readonly capturedAt: string;
  /** The sync item id, so its delivery state can be read from the MR's queue. */
  readonly syncItemId: string;
}

const keyFor = (userId: string): string => `consent.witnessed.v1.${userId}`;

const readAll = async (userId: string): Promise<readonly WitnessedConsent[]> => {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WitnessedConsent[]) : [];
  } catch {
    return [];
  }
};

/** Called by the consent screen when an answer was SENT or QUEUED — never on a refusal. */
export const recordWitnessedConsent = async (entry: WitnessedConsent): Promise<void> => {
  const userId = queueOwner();
  if (userId === null) return;
  const held = await readAll(userId);
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify([...held, entry]));
};

/** The latest answer this phone witnessed for this visit, for the signed-in MR only. */
export const witnessedConsentFor = async (visitId: string): Promise<WitnessedConsent | null> => {
  const userId = queueOwner();
  if (userId === null) return null;
  const mine = (await readAll(userId)).filter((entry) => entry.visitId === visitId);
  return [...mine].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1) ?? null;
};

/** Exported for the test that pins the per-user key. */
export const WITNESSED_KEY = keyFor;

/**
 * What the visit screen says about the doctor's answer, from what this phone witnessed.
 *
 * - An answer SENT (no longer in the MR's queue, or `synced` there) is stated as given.
 * - An answer still `queued` / `in_flight` is stated with "waiting to send".
 * - An answer the server refused is not recorded by `recordWitnessedConsent` at all; one the queue
 *   gave up on (`failed` / `conflict`) says it was not accepted.
 * - **No witnessed answer:** neutral wording that claims neither that the doctor was asked nor
 *   that they were not.
 *
 * `clock` formats the device instant for display; the caller passes the territory-zone clock.
 */
export const describeWitnessed = (
  witnessed: WitnessedConsent | null,
  queue: readonly Pick<SyncQueueItem, 'id' | 'status'>[],
  clock: (iso: string) => string,
): string => {
  if (witnessed === null) {
    return 'This phone does not have the doctor’s answer for this visit.';
  }
  const item = queue.find((candidate) => candidate.id === witnessed.syncItemId);
  const at = clock(witnessed.capturedAt);
  const answer =
    witnessed.outcome === 'consented'
      ? `The doctor agreed to recording, on this phone at ${at}.`
      : witnessed.outcome === 'declined'
        ? `The doctor said no to recording, on this phone at ${at}.`
        : `Recording was not asked about, on this phone at ${at}.`;
  if (item?.status === 'queued' || item?.status === 'in_flight') {
    return `${answer} Waiting to send.`;
  }
  if (item?.status === 'failed' || item?.status === 'conflict') {
    return `${answer} The server did not accept it — see your upload queue.`;
  }
  return answer;
};
