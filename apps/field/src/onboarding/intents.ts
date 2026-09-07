/**
 * The vendor settings intents, in one table, and the rules that stop them crashing
 * the app.
 *
 * **These are undocumented vendor intents.** They are not part of the Android SDK.
 * They differ between skin versions, they are renamed without notice, and Android 11
 * package visibility can hide them from us even when they exist. Every one of them is
 * a guess that was true on somebody's handset once.
 *
 * The consequence, if this is written naively: `startActivity` with a component that
 * does not resolve throws `ActivityNotFoundException`. Not a rejected promise — a
 * crash. On the settings screen, of the onboarding flow, on first run, on precisely
 * the device population these screens exist to serve. The MR's first minute with the
 * app is a crash, caused by the feature meant to help them.
 *
 * So four rules, enforced by the types and functions below rather than left to
 * whoever writes the next screen:
 *
 *   1. **Resolve before offering.** `offerableIntents` probes on THIS device. A
 *      button for an intent that does not resolve is never rendered.
 *   2. **Zero working intents is a supported state.** Every OEM screen renders its
 *      numbered steps and its "What you'll see" text with no buttons at all. The
 *      steps are the product; the deep links are a shortcut.
 *   3. **Wrap the launch anyway.** Probing and launching are separate moments and the
 *      answer can go stale between them — a vendor app can be disabled, frozen or
 *      updated in the gap.
 *   4. **Never throw out of this flow.** A failed settings launch is a normal outcome
 *      and is reported as one. `launchSettings` has no throwing path.
 *
 * One table, one place. Intent strings are never written inline in a component.
 */

import type { OemFamily } from './oem';

/**
 * Two shapes of target, and the distinction is not cosmetic.
 *
 * `action` is a documented `android.settings.*` action carrying no data URI. React
 * Native's `Linking.sendIntent` builds `Intent(action)`, calls `resolveActivity`
 * first, and rejects the promise rather than throwing — so these are reachable today.
 *
 * `app-settings` is this app's own entry in Android Settings. It is its own kind
 * rather than an `action` because `ACTION_APPLICATION_DETAILS_SETTINGS` is inert
 * without a `package:` data URI, and `sendIntent` can set extras but **not data**.
 * `Linking.openSettings()` is the API that sets it correctly, so this kind routes
 * there. Sent as a plain action it would resolve, launch, and land the MR nowhere
 * useful — a working-looking button that does nothing, which is worse than no button.
 *
 * `component` names a vendor package and activity directly. This is what the OEM
 * battery screens actually need, and React Native's `Linking` **cannot express it**:
 * `openURL`/`canOpenURL` build `Intent(ACTION_VIEW, Uri.parse(url))` and never parse a
 * component out of the URL. Reaching these requires a native module
 * (`expo-intent-launcher`), which is not installed — see `SUPPORTED_TARGET_KINDS`.
 */
export type IntentTarget =
  | { readonly kind: 'action'; readonly action: string }
  | { readonly kind: 'app-settings' }
  | { readonly kind: 'component'; readonly packageName: string; readonly activity: string };

export interface SettingsIntent {
  /** Stable id. Used by the step that owns this shortcut, and by the tests. */
  readonly id: string;
  readonly family: OemFamily;
  /**
   * What the vendor calls the destination. Supporting text only, never the whole
   * button label — "Auto-launch" alone does not tell an MR what will happen.
   */
  readonly destination: string;
  readonly target: IntentTarget;
}

/**
 * Documented AOSP actions, used deliberately.
 *
 * The app-info page (reached via the `app-settings` kind) is, on MIUI, ColorOS,
 * Funtouch and Realme UI, the page carrying the per-app battery entry — so it is a
 * genuinely useful destination on all four skins even though it is not the exact
 * vendor screen. Being AOSP, it is reachable on essentially every Android device
 * including the emulator, which is what makes "Open that settings screen" a real
 * button rather than a theoretical one.
 *
 * `IGNORE_BATTERY_OPTIMIZATION_SETTINGS` is the AOSP battery-optimisation list. It is
 * not the vendor's autostart screen and does not replace it.
 */
const BATTERY_OPTIMISATION = 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';

/**
 * THE TABLE. Every vendor intent this app will ever attempt is here.
 *
 * The `component` entries are recorded from crowd-sourced reports, not vendor
 * documentation, because the vendors publish none. They are expected to fail on many
 * devices and that is designed for: they are probed, and a failing probe removes the
 * button and changes nothing else on the screen.
 */
const TABLE: readonly SettingsIntent[] = [
  // --- Xiaomi / MIUI / HyperOS ------------------------------------------------
  {
    id: 'xiaomi-autostart',
    family: 'xiaomi',
    destination: 'Autostart',
    target: {
      kind: 'component',
      packageName: 'com.miui.securitycenter',
      activity: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    },
  },
  {
    id: 'xiaomi-app-details',
    family: 'xiaomi',
    destination: 'App info',
    target: { kind: 'app-settings' },
  },
  {
    id: 'xiaomi-battery',
    family: 'xiaomi',
    destination: 'Battery optimisation',
    target: { kind: 'action', action: BATTERY_OPTIMISATION },
  },

  // --- Oppo / ColorOS ---------------------------------------------------------
  {
    id: 'oppo-autostart',
    family: 'oppo',
    destination: 'Auto-launch',
    target: {
      kind: 'component',
      packageName: 'com.coloros.safecenter',
      activity: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
    },
  },
  {
    id: 'oppo-app-details',
    family: 'oppo',
    destination: 'App info',
    target: { kind: 'app-settings' },
  },
  {
    id: 'oppo-battery',
    family: 'oppo',
    destination: 'Battery optimisation',
    target: { kind: 'action', action: BATTERY_OPTIMISATION },
  },

  // --- Vivo / Funtouch --------------------------------------------------------
  {
    id: 'vivo-autostart',
    family: 'vivo',
    destination: 'Auto-start',
    target: {
      kind: 'component',
      packageName: 'com.vivo.permissionmanager',
      activity: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
    },
  },
  {
    id: 'vivo-app-details',
    family: 'vivo',
    destination: 'App info',
    target: { kind: 'app-settings' },
  },
  {
    id: 'vivo-battery',
    family: 'vivo',
    destination: 'Battery optimisation',
    target: { kind: 'action', action: BATTERY_OPTIMISATION },
  },

  // --- Realme UI --------------------------------------------------------------
  // Realme UI is ColorOS-derived and has historically shipped the same safecenter
  // package. Recorded as its own rows anyway: the skins have diverged, and sharing a
  // row would mean a Realme correction silently changing Oppo behaviour — the same
  // conflation the detection function exists to prevent.
  {
    id: 'realme-autostart',
    family: 'realme',
    destination: 'Auto-launch',
    target: {
      kind: 'component',
      packageName: 'com.coloros.safecenter',
      activity: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
    },
  },
  {
    id: 'realme-app-details',
    family: 'realme',
    destination: 'App info',
    target: { kind: 'app-settings' },
  },
  {
    id: 'realme-battery',
    family: 'realme',
    destination: 'Battery optimisation',
    target: { kind: 'action', action: BATTERY_OPTIMISATION },
  },

  // --- Unknown ----------------------------------------------------------------
  // Generic guidance still gets the two AOSP destinations. There is no vendor screen
  // to guess at, and these two are where the equivalent settings live on stock.
  {
    id: 'unknown-app-details',
    family: 'unknown',
    destination: 'App info',
    target: { kind: 'app-settings' },
  },
  {
    id: 'unknown-battery',
    family: 'unknown',
    destination: 'Battery optimisation',
    target: { kind: 'action', action: BATTERY_OPTIMISATION },
  },
];

/** Every intent declared for a family, before any device has been consulted. */
export const intentsFor = (family: OemFamily): readonly SettingsIntent[] =>
  TABLE.filter((intent) => intent.family === family);

/** The whole table, for the tests that assert properties across all of it. */
export const allSettingsIntents = (): readonly SettingsIntent[] => TABLE;

/**
 * What the launcher on this build can actually express.
 *
 * `component` is absent because React Native's `Linking` cannot target a component and
 * `expo-intent-launcher` is not a dependency of this app. Adding it is a native module
 * and therefore a dev-client rebuild — a deliberate decision, not a side effect of
 * this sprint.
 *
 * The effect is exactly the designed fallback rather than a defect: component intents
 * never resolve, their buttons never render, and the numbered steps carry the flow.
 * Widening this set is the only change needed when the native module lands — no
 * component and no screen changes with it.
 */
export const SUPPORTED_TARGET_KINDS: readonly IntentTarget['kind'][] = ['action', 'app-settings'];

export const isExpressible = (intent: SettingsIntent): boolean =>
  SUPPORTED_TARGET_KINDS.includes(intent.target.kind);
