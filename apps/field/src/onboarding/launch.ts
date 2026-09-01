/**
 * Probing and launching vendor settings intents, with no path that throws.
 *
 * The port is an interface rather than a direct `Linking` call so that the rules in
 * `intents.ts` can be tested against a device that resolves nothing, a device that
 * resolves everything, and a device whose probe itself explodes — none of which can
 * be arranged on the emulator, and two of which are the states that matter.
 *
 * `device.ts` supplies the real implementation. Nothing else in the app may call
 * `Linking` for a settings intent.
 */

import type { SettingsIntent } from './intents';
import { isExpressible } from './intents';

/**
 * The three ways this ends, all of them normal.
 *
 * There is no `'error'` member on purpose. A settings screen that cannot be opened is
 * not an application error — it is the ordinary condition on most of the devices this
 * feature targets, and modelling it as an error is what produces a crash dialog in
 * front of an MR who has done nothing wrong.
 */
export type LaunchOutcome =
  /** The vendor screen is now in front of the MR. */
  | 'opened'
  /** Nothing on this device handles it. Expected, and common. */
  | 'unresolvable'
  /** It resolved, then failed anyway — the probe went stale, or the vendor app is disabled. */
  | 'failed';

/**
 * The native boundary.
 *
 * `probe` answers whether this device can open the intent *right now*. It may reject;
 * callers here treat a rejection as "no", never as an error to surface.
 *
 * `launch` may reject too. Every caller goes through `launchSettings`, which converts
 * that into a `LaunchOutcome`.
 */
export interface SettingsLauncher {
  readonly probe: (intent: SettingsIntent) => Promise<boolean>;
  readonly launch: (intent: SettingsIntent) => Promise<void>;
}

/**
 * Which intents this device will actually honour — the list a screen may render
 * buttons for.
 *
 * **Rule 1.** Two filters, and both are needed. `isExpressible` rejects targets the
 * launcher on this build cannot even form (component intents, today). The probe then
 * asks the device about the rest. An intent that fails either check is dropped
 * silently: there is nothing to tell the MR, because a shortcut they were never
 * offered has not gone missing.
 *
 * A probe that rejects counts as "not offerable". Package-visibility restrictions on
 * Android 11+ make a false negative the normal answer for another app's activity, and
 * treating that as a failure to report would put a warning on screen for a device
 * that is behaving exactly as Android intends.
 *
 * Probes run concurrently — there can be three per screen, and doing them in series
 * puts a visible delay in front of the buttons appearing.
 */
export const offerableIntents = async (
  intents: readonly SettingsIntent[],
  launcher: SettingsLauncher,
): Promise<readonly SettingsIntent[]> => {
  const verdicts = await Promise.all(
    intents.map(async (intent) => {
      if (!isExpressible(intent)) return false;
      try {
        return await launcher.probe(intent);
      } catch {
        return false;
      }
    }),
  );

  return intents.filter((_intent, index) => verdicts[index] === true);
};

/**
 * Open a settings screen. **Rules 3 and 4: this function cannot throw.**
 *
 * The `isExpressible` guard is repeated here rather than assumed from
 * `offerableIntents`, because the two are separate entry points and a future screen
 * that calls this directly must not be able to reach a component intent the launcher
 * cannot form.
 *
 * The probe is deliberately *not* repeated. It was true when the button rendered and
 * re-checking narrows a race it cannot close — the vendor app can be frozen in the
 * microseconds after any check. The try/catch is what actually makes this safe, so it
 * is the try/catch that is relied on.
 */
export const launchSettings = async (
  intent: SettingsIntent,
  launcher: SettingsLauncher,
): Promise<LaunchOutcome> => {
  if (!isExpressible(intent)) return 'unresolvable';

  try {
    await launcher.launch(intent);
    return 'opened';
  } catch {
    // Swallowed on purpose, and this is the line the whole module exists for.
    // `ActivityNotFoundException` surfaces here as a rejected promise; letting it
    // past this point is the crash described at the top of `intents.ts`.
    return 'failed';
  }
};

/**
 * A launcher for a device that honours nothing.
 *
 * Exported because it is the honest default for any environment with no Android
 * underneath it — a test, a story, the web preview — and because "what does this
 * screen look like with zero working intents" is a question the team should be able
 * to answer by construction rather than by finding a Xiaomi.
 */
export const nullLauncher: SettingsLauncher = {
  probe: () => Promise.resolve(false),
  launch: () => Promise.reject(new Error('No settings launcher on this platform.')),
};
