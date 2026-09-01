/**
 * Design tokens.
 *
 * Structure first, values second. Every colour below is a reference into
 * `palette.ts`. That property is what made the brand swap a one-file change when
 * Phase 1 was committed, and `tokens.test.ts` asserts it mechanically — a colour
 * literal written directly into this file fails the build.
 *
 * `requiredContrastPairs` is the list of pairs that have a WCAG obligation. It is
 * not documentation: every entry is checked on every test run, so a palette swap
 * that introduces an inaccessible pair goes red here rather than reaching a screen.
 */

import type { ContrastUsage } from './contrast.js';
import { brandPalette } from './palette.js';

export interface ColorTokens {
  /** The page ground. */
  readonly background: string;
  /** Raised surfaces — cards, sheets, list rows. */
  readonly surface: string;
  /** Control edges only. */
  readonly border: string;
  /** Dividers inside a card. Decorative — no contrast obligation. */
  readonly hairline: string;
  readonly textPrimary: string;
  /**
   * Everything not primary. Phase 1 bans a third grey, so anything that is
   * neither `textPrimary` nor this is a mistake.
   */
  readonly textSecondary: string;
  /** Primary action fill. */
  readonly accent: string;
  readonly accentPressed: string;
  /** Label on `accent`. */
  readonly onAccent: string;
  /** Recessed fill — secondary buttons, inactive chips. */
  readonly wash: string;
  readonly washPressed: string;
  /**
   * Genuine failures only — a rejected sync item, a lost upload.
   *
   * **Never for a declined consent.** All three consent outcomes are successful
   * completions of a visit; colouring `declined` as an error is the dark pattern
   * that collapses the legal basis for recording. See `docs/frontendplanv2.md` §3.2.
   */
  readonly critical: string;
  /** Tint behind a critical message. */
  readonly criticalFill: string;
  /** Attention, not failure — "battery saver is on". */
  readonly attention: string;
  readonly attentionFill: string;
  readonly success: string;
  readonly successFill: string;
  readonly info: string;
  readonly infoFill: string;
  /**
   * Offline. A wash and a neutral slate, never amber and never red: an MR out of
   * signal is working normally, and colouring that as a fault tells them the app
   * has broken when it has not.
   */
  readonly offlineFill: string;
  readonly offlineEdge: string;
  /**
   * Recording in progress. **Terracotta by decision, not signal red** — a doctor
   * glancing across the desk should read "on", not "alarm".
   */
  readonly recording: string;
}

export interface SpaceTokens {
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
}

export interface RadiusTokens {
  readonly sm: number;
  readonly md: number;
  readonly pill: number;
}

export interface TypeStyle {
  readonly size: number;
  readonly lineHeight: number;
  /** 400 is the floor. Phase 1 bans DM Sans below it, anywhere. */
  readonly weight: '400' | '500' | '600' | '700';
  /** Absolute px, negative to tighten. Large figures are tracked in. */
  readonly letterSpacing?: number;
}

/**
 * Phase 1's scale, its names and its floors.
 *
 * Body is 16 against the Tier 2 standard-density 15, because this is read outdoors
 * on a mid-range Android at partial brightness. Figures run large and tight — a
 * number an MR reads while walking has to survive a glance.
 *
 * Phase 1's banned list, for anyone tempted: DM Sans below 400 anywhere, body below
 * 16, any tappable label below 14, and a third grey.
 */
export interface TypographyTokens {
  /** 40/600/−.045 — the money figure. One per screen. */
  readonly figure: TypeStyle;
  /** 30/600/−.035 — "That's Dr. Iyer done". */
  readonly display: TypeStyle;
  /** 27/600/−.035 — screen titles. */
  readonly title: TypeStyle;
  readonly heading: TypeStyle;
  readonly body: TypeStyle;
  /** 14.5/400 — "31.7 km · on this month's claim". */
  readonly secondary: TypeStyle;
  readonly label: TypeStyle;
}

/**
 * Reach. Every screen in this app is a one-thumb screen — the other hand is
 * holding a detail bag.
 *
 * On an 844pt canvas the reach zone is the bottom 281pt. A screen's single primary
 * action originates inside it, pinned, never scrolled to. Two primary actions on
 * one screen means the screen is wrong; split it. Destructive and irreversible
 * actions are the deliberate exception — they sit *outside* the zone so a resting
 * thumb cannot fire them.
 */
export interface TargetTokens {
  /** Absolute floor for anything tappable. */
  readonly floor: number;
  readonly secondary: number;
  readonly primary: number;
  /** Pressed while walking, in a corridor, without looking. */
  readonly inVisit: number;
  /** Minimum gap between adjacent targets. */
  readonly gap: number;
  /** Fraction of screen height reserved for the reach zone (281/844). */
  readonly reachZoneFraction: number;
}

export interface DesignTokens {
  /**
   * `brand` since Phase 1 was committed to `docs/design/`. It was `placeholder`
   * for the first four weeks; the field stays on the object because a consumer
   * asserting it is how the placeholder period stayed honest.
   */
  readonly status: 'placeholder' | 'brand';
  readonly color: ColorTokens;
  readonly space: SpaceTokens;
  readonly radius: RadiusTokens;
  readonly typography: TypographyTokens;
  readonly target: TargetTokens;
}

export const tokens: DesignTokens = {
  status: 'brand',
  color: {
    background: brandPalette.paper,
    surface: brandPalette.card,
    border: brandPalette.border,
    hairline: brandPalette.hairline,
    textPrimary: brandPalette.ink,
    textSecondary: brandPalette.muted,
    accent: brandPalette.accent,
    accentPressed: brandPalette.accentPressed,
    onAccent: brandPalette.white,
    wash: brandPalette.wash,
    washPressed: brandPalette.washPressed,
    critical: brandPalette.critical,
    criticalFill: brandPalette.criticalFill,
    attention: brandPalette.attention,
    attentionFill: brandPalette.attentionFill,
    success: brandPalette.accent,
    successFill: brandPalette.successFill,
    info: brandPalette.info,
    infoFill: brandPalette.infoFill,
    offlineFill: brandPalette.offlineFill,
    offlineEdge: brandPalette.offlineEdge,
    recording: brandPalette.recording,
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, pill: 999 },
  typography: {
    figure: { size: 40, lineHeight: 44, weight: '600', letterSpacing: -1.8 },
    display: { size: 30, lineHeight: 34, weight: '600', letterSpacing: -1.05 },
    title: { size: 27, lineHeight: 30, weight: '600', letterSpacing: -0.95 },
    heading: { size: 16.5, lineHeight: 22, weight: '600' },
    body: { size: 16, lineHeight: 24, weight: '400' },
    secondary: { size: 14.5, lineHeight: 21, weight: '400' },
    label: { size: 13.5, lineHeight: 18, weight: '500' },
  },
  target: {
    floor: 44,
    secondary: 52,
    primary: 60,
    inVisit: 66,
    gap: 8,
    reachZoneFraction: 281 / 844,
  },
};

export interface ContrastPair {
  readonly name: string;
  readonly foreground: string;
  readonly background: string;
  readonly usage: ContrastUsage;
}

/** Every pair with a WCAG obligation, checked on every test run. */
export const requiredContrastPairs: readonly ContrastPair[] = [
  {
    name: 'primary text on background',
    foreground: tokens.color.textPrimary,
    background: tokens.color.background,
    usage: 'text',
  },
  {
    name: 'primary text on surface',
    foreground: tokens.color.textPrimary,
    background: tokens.color.surface,
    usage: 'text',
  },
  {
    name: 'secondary text on background',
    foreground: tokens.color.textSecondary,
    background: tokens.color.background,
    usage: 'text',
  },
  {
    name: 'secondary text on surface',
    foreground: tokens.color.textSecondary,
    background: tokens.color.surface,
    usage: 'text',
  },
  {
    name: 'primary button label on primary button fill',
    foreground: tokens.color.onAccent,
    background: tokens.color.accent,
    usage: 'text',
  },
  {
    name: 'primary button fill against the page',
    foreground: tokens.color.accent,
    background: tokens.color.background,
    usage: 'non-text',
  },
  {
    name: 'critical text on background',
    foreground: tokens.color.critical,
    background: tokens.color.background,
    usage: 'text',
  },
  {
    name: 'critical text on its own tint',
    foreground: tokens.color.critical,
    background: tokens.color.criticalFill,
    usage: 'text',
  },
  {
    name: 'attention text on its own tint',
    foreground: tokens.color.attention,
    background: tokens.color.attentionFill,
    usage: 'text',
  },
  {
    name: 'success text on its own tint',
    foreground: tokens.color.success,
    background: tokens.color.successFill,
    usage: 'text',
  },
  {
    name: 'info text on its own tint',
    foreground: tokens.color.info,
    background: tokens.color.infoFill,
    usage: 'text',
  },
  {
    name: 'primary text on the offline fill',
    foreground: tokens.color.textPrimary,
    background: tokens.color.offlineFill,
    usage: 'text',
  },
  {
    // Offline is not an error, but it still has to be readable. This pair is why
    // the offline state can stay neutral without becoming invisible.
    name: 'secondary text on the offline fill',
    foreground: tokens.color.textSecondary,
    background: tokens.color.offlineFill,
    usage: 'text',
  },
  {
    name: 'white on the recording bar',
    foreground: tokens.color.onAccent,
    background: tokens.color.recording,
    usage: 'text',
  },
  {
    name: 'secondary button label on wash',
    foreground: tokens.color.textPrimary,
    background: tokens.color.wash,
    usage: 'text',
  },
  {
    name: 'control border against the page',
    foreground: tokens.color.border,
    background: tokens.color.background,
    usage: 'non-text',
  },
];
