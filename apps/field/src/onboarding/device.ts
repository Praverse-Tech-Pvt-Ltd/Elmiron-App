/**
 * The native boundary. The only file in the onboarding flow that touches the device.
 *
 * Everything above this — detection, the intent table, the resolve rule, the copy —
 * is pure and runs under vitest with no Android attached. This file is the part that
 * cannot be tested on this machine, so it is kept as small as it can be: read three
 * constants, and adapt `Linking` to the `SettingsLauncher` port.
 *
 * `Platform` and `Linking` are non-visual APIs and are permitted in `apps/field` by
 * the component-extraction rule in `eslint.config.mjs`. No visual primitive is
 * imported here or anywhere else in this app.
 */

import { Linking, Platform } from 'react-native';
import { detectOem } from './oem';
import type { DeviceIdentity, OemFamily } from './oem';
import type { SettingsIntent } from './intents';
import type { SettingsLauncher } from './launch';
import { nullLauncher } from './launch';

/**
 * What Android says about itself.
 *
 * `Platform.constants` is typed loosely across platforms, so the read is narrowed
 * here rather than at every call site. On iOS and web these fields are simply absent
 * and detection returns `unknown`, which is the correct answer — this app is
 * Android-only, and the generic screen is a valid thing to render anywhere else.
 */
const readIdentity = (): DeviceIdentity => {
  if (Platform.OS !== 'android') return {};

  // The cast is the boundary. `Platform.constants` on Android carries these three
  // fields; the union type across platforms does not admit them, and narrowing by
  // `Platform.OS` is the check that makes reading them sound.
  const constants = Platform.constants as Partial<{
    Manufacturer: string;
    Brand: string;
    Model: string;
  }>;

  return {
    manufacturer: constants.Manufacturer,
    brand: constants.Brand,
    model: constants.Model,
  };
};

/**
 * Which skin this device runs. The native read, performed once, at the call site.
 *
 * The mapping it feeds is `detectOem`, which is pure and separately tested. This
 * function exists only to get three strings out of the platform.
 */
export const detectDeviceOem = (): OemFamily => detectOem(readIdentity());

/**
 * The real launcher, built on React Native's `Linking`.
 *
 * **`sendIntent` is used rather than `openURL`, and that is not interchangeable.**
 * Read from `IntentModule.kt` in the installed React Native rather than from the
 * docs:
 *
 *   - `sendIntent(action)` builds `Intent(action)`, calls `resolveActivity` first,
 *     and **rejects the promise** when nothing handles it. It does not throw
 *     `ActivityNotFoundException` into the app.
 *   - `openSettings()` builds `ACTION_APPLICATION_DETAILS_SETTINGS` with the
 *     `package:` data URI and `CATEGORY_DEFAULT`, and wraps the whole thing in
 *     try/catch, rejecting rather than throwing. This is the only correct way to
 *     reach the app-info page: `sendIntent` can set extras but not data, and that
 *     action without its data URI lands nowhere.
 *   - `openURL(url)` / `canOpenURL(url)` build `Intent(ACTION_VIEW, Uri.parse(url))`.
 *     They never parse a component out of an `intent://` URL, so they cannot reach a
 *     vendor activity at all.
 *
 * That is why `SUPPORTED_TARGET_KINDS` is `['action', 'app-settings']`. Component-targeted vendor
 * intents need `expo-intent-launcher`, a native module and therefore a dev-client
 * rebuild. Until it is added, `offerableIntents` withholds those buttons and the
 * numbered steps carry the flow — the designed fallback, running as the default.
 *
 * **One narrowing of rule 1, recorded rather than hidden.** React Native exposes no
 * `resolveActivity` for a bare action, and `canOpenURL` answers a different question,
 * so `probe` cannot ask "would this open?" without opening it. It therefore returns
 * `true` for the two expressible kinds, and the real resolve check is the one
 * `sendIntent` performs natively in the instant before it launches.
 *
 * That is safe in the way that matters: the check still happens before any activity
 * starts, and its failure arrives as a rejected promise that `launchSettings` turns
 * into `'failed'`. What is lost is only the ability to hide the button in advance on
 * a device where the action is missing — the MR sees a button, presses it, and gets a
 * "couldn't open" line instead of a crash. Rule 2 is what makes that acceptable: the
 * numbered steps are on the screen either way.
 */
export const linkingLauncher: SettingsLauncher = {
  probe: (intent: SettingsIntent): Promise<boolean> =>
    Promise.resolve(intent.target.kind === 'action' || intent.target.kind === 'app-settings'),

  launch: async (intent: SettingsIntent): Promise<void> => {
    switch (intent.target.kind) {
      case 'action':
        await Linking.sendIntent(intent.target.action);
        return;
      case 'app-settings':
        await Linking.openSettings();
        return;
      default:
        // `component`. Unreachable through `launchSettings`, which checks
        // `isExpressible` first; thrown rather than ignored so a direct caller that
        // skipped that check fails loudly here instead of silently doing nothing.
        throw new Error(`No launcher on this build for a ${intent.target.kind} intent.`);
    }
  },
};

/**
 * The launcher to use. Android gets `Linking`; everything else gets the null
 * launcher, which resolves nothing and renders every screen in its fallback state.
 */
export const deviceLauncher: SettingsLauncher =
  Platform.OS === 'android' ? linkingLauncher : nullLauncher;
