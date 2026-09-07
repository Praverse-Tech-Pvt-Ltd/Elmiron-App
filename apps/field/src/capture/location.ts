import * as Location from 'expo-location';
import type { Coordinates } from '@fieldforce/core';

/**
 * A position fix, taken only when the MR presses a button.
 *
 * **This module is the implementation of `fe-w3-spec.md` §4a: discrete fixes
 * only.** There is no watcher, no subscription, no task and no service here, and
 * there is deliberately no function that starts one. A position is read when
 * `takeFix` is called, which happens on a check-in or check-out press and at no
 * other time.
 *
 * Three things follow from that, and each is a promise the app makes to the MR on
 * the transparency screen:
 *
 * - `requestForegroundPermissionsAsync`, never
 *   `requestBackgroundPermissionsAsync`. The manifest does not carry
 *   `ACCESS_BACKGROUND_LOCATION` either, so the background call would fail anyway —
 *   two locks on the same door, because this is the one that turns the app into a
 *   tracker if it ever slips.
 * - **Nothing is cached.** A fix is used for the request that asked for it and then
 *   forgotten. There is no last-known-position to leak into a later screen and no
 *   store for one.
 * - **`Accuracy.Balanced`, not `Highest`.** A clinic geofence is tens of metres;
 *   `Highest` spins the GPS radio for precision nobody uses and costs battery on a
 *   phone that has to last a shift.
 */
export type FixOutcome =
  | { readonly kind: 'fix'; readonly coordinates: Coordinates }
  /** The MR said no. A normal answer, and never an error. */
  | { readonly kind: 'denied' }
  /** Permission granted, but the device could not produce a position in time. */
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * How long to wait before giving up.
 *
 * An MR standing in a clinic doorway with a weak sky view will not wait, and a
 * spinner that never resolves is how a check-in gets abandoned. Ten seconds then a
 * clear answer.
 */
export const FIX_TIMEOUT_MS = 10_000;

const timeout = (ms: number): Promise<'timeout'> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve('timeout');
    }, ms);
  });

export const takeFix = async (timeoutMs: number = FIX_TIMEOUT_MS): Promise<FixOutcome> => {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { kind: 'denied' };

  try {
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout(timeoutMs),
    ]);

    if (result === 'timeout') {
      return { kind: 'unavailable', reason: 'The phone could not find your position in time.' };
    }

    return {
      kind: 'fix',
      coordinates: {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracyMetres: result.coords.accuracy,
        // The device's clock, and labelled as such by the contract: `occurredAt`
        // is "what the device says. Its clock is not trusted", and the server
        // stamps `receivedAt` beside it so a late sync can be reconciled.
        capturedAt: new Date(result.timestamp).toISOString(),
      },
    };
  } catch (error: unknown) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : 'The phone could not find your position.',
    };
  }
};

/**
 * Whether location has already been granted, without asking for it.
 *
 * Used to decide what the check-in button says before it is pressed — never to take
 * a position. `getForegroundPermissionsAsync` does not prompt.
 */
export const locationGranted = async (): Promise<boolean> => {
  const permission = await Location.getForegroundPermissionsAsync();
  return permission.granted;
};
