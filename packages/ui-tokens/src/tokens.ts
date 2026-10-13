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
  readonly successFillPressed: string;
  /** The voice note's hold-to-record button, with ink on it. Not an action colour. */
  readonly sage: string;
  readonly sagePressed: string;
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

/**
 * Phase 1 §05 names three radii the original scale did not carry: a 16 on every
 * control, a 20 on every card and sheet, and a 12 on the tinted wells inside a
 * card. `sm` and `md` predate the design and are kept because existing screens use
 * them; new work takes `control`, `card` or `well`, which are the design's own.
 */
export interface RadiusTokens {
  readonly sm: number;
  readonly md: number;
  /** Tinted well inside a card — a semantic fill, a quote block, a chip. */
  readonly well: number;
  /** Buttons, inputs, icon buttons. Phase 1 §05. */
  readonly control: number;
  /** Cards, sheets, the hero. Phase 1 §05. */
  readonly card: number;
  readonly pill: number;
}

/**
 * The typeface, one family name per weight.
 *
 * **Android does not synthesise a weight from a family.** `fontWeight: '600'` over
 * a `fontFamily` of "DM Sans" gets you whatever single face the system matched,
 * which on the OEM builds this product targets is the regular one — the scale
 * renders at the right size and the wrong weight, and nothing fails. React Native
 * documents this: on Android each weight is a separate registered family. So the
 * family name carries the weight, and `fontFamilyFor` is the only way a component
 * is allowed to reach for one.
 *
 * The names are `@expo-google-fonts/dm-sans`'s own export identifiers, because
 * `useFonts` registers each face under the key it is given and a name invented here
 * would register nothing. `apps/field/app/_layout.tsx` loads them.
 *
 * §03 bans DM Sans below 400 anywhere, so 100–300 are absent by construction: a
 * weight this map has no entry for cannot be asked for.
 */
export interface FontTokens {
  readonly '400': string;
  readonly '500': string;
  readonly '600': string;
  readonly '700': string;
  /**
   * Cormorant Garamond, and it has exactly one use.
   *
   * §03: "The one Cormorant moment — login splash only, weight 500 at 36px. Not a
   * screen title, not a section header, not an empty state." It is deliberately
   * outside the weight map above so it cannot be reached through
   * `fontFamilyFor` — the only way to render it is `BrandLine`, and
   * `packages/ui`'s own test asserts that no other component imports it.
   */
  readonly brand: string;
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
  /** 17/600 — every button label. Phase 1 §05, and never uppercased. */
  readonly control: TypeStyle;
  /** 19/400 — the value inside an input, larger than body on purpose. §05. */
  readonly value: TypeStyle;
  /**
   * 36/500 — the brand line, and nothing else. §03's single Cormorant exception.
   *
   * Its own step because it is not part of the working scale: no screen composes
   * with it, nothing steps down from it, and it appears once in the product.
   */
  readonly brand: TypeStyle;
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
  /**
   * A list row and a sheet row. Taller than the touch floor because a row is read
   * before it is tapped, and the reading is what needs the height. Phase 1 §05.
   */
  readonly row: number;
  /** Minimum gap between adjacent targets. */
  readonly gap: number;
  /** Fraction of screen height reserved for the reach zone (281/844). */
  readonly reachZoneFraction: number;
  /**
   * The tab bar's own height, above the gesture inset: a 28pt icon well, an 18pt label and the
   * padding around them. The navigator's default (49) is iOS's, and with a 13.5 label under a
   * drawn icon it left the label touching the bar's bottom edge.
   */
  readonly tabBar: number;
}

/**
 * One layer of a shadow, in the shape React Native's `boxShadow` takes (and CSS's `box-shadow`
 * describes), so a level can be handed straight to a style without translation.
 */
export interface ShadowLayer {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  /** Negative pulls the shadow in under the surface — how the design keeps a deep shadow soft. */
  readonly spreadDistance: number;
  /** `#RRGGBBAA`, always a palette colour plus an alpha — see `withAlpha`. */
  readonly color: string;
}

export interface ElevationLevel {
  /** Drawn bottom-most last, as CSS and React Native both order them. Empty is flat. */
  readonly layers: readonly ShadowLayer[];
  /**
   * The Android `elevation` used where `boxShadow` cannot draw — outset shadows need API 28. Only
   * ever applied INSTEAD of `layers`, never beside them, or a card would cast two shadows.
   */
  readonly androidFallback: number;
}

/**
 * Depth, as the designs draw it.
 *
 * Every shadow in Phases 1–4 is the same warm ink (`palette.shadow`) at a low alpha, and the
 * deep ones are pulled in with a negative spread so they read as a soft pool under the surface
 * rather than a dark halo around it. These are those values — taken from the design files, not
 * invented — so a card in the app sits on the page the way it sits in the mock.
 *
 * A level is chosen by what the surface IS, never by how important it feels:
 *
 * - `flat` — on the page: offline (§02 — waiting, not arriving) and quiet notes.
 * - `hairline` — a list row or a chip. One tiny layer, cheap enough for every row of a long list.
 * - `card` — a card resting on the page.
 * - `raised` — the screen's one dark hero.
 * - `floating` — something over the content: a toast.
 * - `sheet` — a bottom sheet, casting upward over the page it covers.
 * - `dock` — the tab bar and a pinned footer: content scrolls under them.
 * - `accent` — the primary action's own soft underglow, in its own colour. One per screen,
 *   because there is one primary per screen.
 */
export interface ElevationTokens {
  readonly flat: ElevationLevel;
  readonly hairline: ElevationLevel;
  readonly card: ElevationLevel;
  readonly raised: ElevationLevel;
  readonly floating: ElevationLevel;
  readonly sheet: ElevationLevel;
  readonly dock: ElevationLevel;
  readonly accent: ElevationLevel;
}

/**
 * Motion. Short, and only ever confirming something that already happened — content arriving, a
 * toast appearing, a sheet rising. **Nothing waits for an animation**: every duration here is
 * under the ~400ms at which a transition starts to read as the app being slow, and a control is
 * live from its first frame. All of it is skipped when Android's "Remove animations" is on.
 *
 * §05 still holds for presses: a press darkens the fill and never scales or fades. Motion here is
 * for arrival, never for a press.
 */
export interface MotionTokens {
  /** A toast, a small state change. */
  readonly quick: number;
  /** Content fading up into place. */
  readonly standard: number;
  /** A sheet rising. */
  readonly gentle: number;
  /** Delay between successive blocks arriving, so a screen settles top to bottom. */
  readonly stagger: number;
  /** How far (pt) content rises as it fades in. Small: arrival, not travel. */
  readonly rise: number;
  /** One half-cycle of a loading placeholder's breathing. Slow, so it never flickers. */
  readonly pulse: number;
}

export interface OverlayTokens {
  /** Behind a bottom sheet. The shadow ink at 40%, as the design's sheets are drawn. */
  readonly scrim: string;
}

export interface DesignTokens {
  /**
   * `brand` since Phase 1 was committed to `docs/design/`. It was `placeholder`
   * for the first four weeks; the field stays on the object because a consumer
   * asserting it is how the placeholder period stayed honest.
   */
  readonly status: 'placeholder' | 'brand';
  readonly color: ColorTokens;
  readonly font: FontTokens;
  readonly space: SpaceTokens;
  readonly radius: RadiusTokens;
  readonly typography: TypographyTokens;
  readonly target: TargetTokens;
  readonly elevation: ElevationTokens;
  readonly motion: MotionTokens;
  readonly overlay: OverlayTokens;
}

/**
 * A palette colour at an alpha, as `#RRGGBBAA`.
 *
 * The only way a translucent colour is made, so a shadow or a scrim still traces back to a named
 * palette entry — `tokens.test.ts` checks that every one does. Accepts `#RRGGBB` only.
 */
export const withAlpha = (hex: string, alpha: number): string => {
  if (!/^#[0-9A-Fa-f]{6}$/u.test(hex)) {
    throw new Error(`withAlpha takes #RRGGBB, got ${hex}`);
  }
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new Error(`withAlpha takes an alpha in [0, 1], got ${String(alpha)}`);
  }
  const byte = Math.round(alpha * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `${hex.toUpperCase()}${byte}`;
};

const shade = (alpha: number): string => withAlpha(brandPalette.shadow, alpha);

const layer = (
  offsetY: number,
  blurRadius: number,
  spreadDistance: number,
  color: string,
): ShadowLayer => ({ offsetX: 0, offsetY, blurRadius, spreadDistance, color });

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
    successFillPressed: brandPalette.successFillPressed,
    sage: brandPalette.sage,
    sagePressed: brandPalette.sagePressed,
    info: brandPalette.info,
    infoFill: brandPalette.infoFill,
    offlineFill: brandPalette.offlineFill,
    offlineEdge: brandPalette.offlineEdge,
    recording: brandPalette.recording,
  },
  font: {
    '400': 'DMSans_400Regular',
    '500': 'DMSans_500Medium',
    '600': 'DMSans_600SemiBold',
    '700': 'DMSans_700Bold',
    brand: 'CormorantGaramond_500Medium',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, well: 12, control: 16, card: 20, pill: 999 },
  typography: {
    figure: { size: 40, lineHeight: 44, weight: '600', letterSpacing: -1.8 },
    display: { size: 30, lineHeight: 34, weight: '600', letterSpacing: -1.05 },
    title: { size: 27, lineHeight: 30, weight: '600', letterSpacing: -0.95 },
    heading: { size: 16.5, lineHeight: 22, weight: '600' },
    body: { size: 16, lineHeight: 24, weight: '400' },
    secondary: { size: 14.5, lineHeight: 21, weight: '400' },
    label: { size: 13.5, lineHeight: 18, weight: '500' },
    control: { size: 17, lineHeight: 22, weight: '600' },
    value: { size: 19, lineHeight: 24, weight: '400' },
    brand: { size: 36, lineHeight: 42, weight: '500' },
  },
  target: {
    floor: 44,
    secondary: 52,
    primary: 60,
    inVisit: 66,
    row: 70,
    gap: 8,
    reachZoneFraction: 281 / 844,
    tabBar: 64,
  },
  // The design's own shadows (`box-shadow` in docs/design/*.dc.html), layer for layer.
  elevation: {
    flat: { layers: [], androidFallback: 0 },
    // "0 1px 2px rgba(20,21,15,.05)" — Phase 1's list rows.
    hairline: { layers: [layer(1, 2, 0, shade(0.05))], androidFallback: 1 },
    // "0 1px 2px rgba(20,21,15,.04), 0 14px 34px -22px rgba(20,21,15,.4)" — B1's cards.
    card: {
      layers: [layer(1, 2, 0, shade(0.04)), layer(14, 34, -22, shade(0.4))],
      androidFallback: 2,
    },
    // B1's hero, "0 18px 40px -24px rgba(20,21,15,.8)", with the contact layer the cards carry.
    raised: {
      layers: [layer(2, 6, 0, shade(0.06)), layer(18, 40, -24, shade(0.8))],
      androidFallback: 6,
    },
    // "0 1px 2px rgba(20,21,15,.04), 0 16px 40px -22px rgba(20,21,15,.35)", lifted a step so a
    // toast clears the cards it floats over.
    floating: {
      layers: [layer(2, 6, 0, shade(0.06)), layer(16, 40, -20, shade(0.4))],
      androidFallback: 8,
    },
    // "0 -10px 44px -14px rgba(20,21,15,.35)" — the design's sheets.
    sheet: { layers: [layer(-10, 44, -14, shade(0.35))], androidFallback: 16 },
    // The sheet's direction at a third of its weight: content passes under the tab bar and the
    // pinned footer, and this says so without drawing a line across the screen.
    dock: { layers: [layer(-6, 24, -12, shade(0.12))], androidFallback: 0 },
    // "0 18px 40px -24px rgba(53,89,58,.9)", Phase 2's primary action, softened: the design draws
    // it on one button, the app has one primary per screen and it should glow, not shout.
    accent: {
      layers: [layer(14, 32, -18, withAlpha(brandPalette.accent, 0.55))],
      androidFallback: 0,
    },
  },
  motion: { quick: 160, standard: 240, gentle: 320, stagger: 50, rise: 8, pulse: 900 },
  overlay: { scrim: shade(0.4) },
};

/**
 * The family for a weight in the committed scale.
 *
 * Every piece of text in `packages/ui` goes through this. A component that sets
 * `fontWeight` without it renders in the platform's own face — which is what the
 * whole app did until this was added, and which nothing caught because Roboto at
 * the right size and weight looks like a deliberate choice.
 */
export const fontFamilyFor = (weight: TypeStyle['weight']): string => tokens.font[weight];

/**
 * The console's scale — Phase 4: "the same Phase 1 tokens at compact density".
 *
 * **A desk product on a laptop, not a phone in the sun.** Phase 1's floors — body
 * at 16, no tappable label below 14 — are justified by a specific situation:
 * outdoors, mid-range Android, partial brightness, one thumb. A manager at a desk
 * with a mouse is none of those, and holding a phone's floors on a 1320px console
 * costs rows on screen for no legibility anyone gains. Phase 4 sets the base at
 * 13–15px and this is that.
 *
 * **Every step is chosen, not multiplied.** A blind 0.875 factor would produce
 * values like 11.8 that no one decided on, and would quietly drag the figure role
 * under the point where tabular digits still read across a table. The ratios of
 * the committed scale are preserved; the numbers are picked.
 *
 * The colour tokens are shared unchanged, which is the point of "same tokens":
 * `requiredContrastPairs` already covers every pair the console uses, so nothing
 * here can introduce an inaccessible combination.
 */
export const compactTypography: TypographyTokens = {
  figure: { size: 29, lineHeight: 33, weight: '600', letterSpacing: -1.15 },
  display: { size: 26, lineHeight: 30, weight: '600', letterSpacing: -0.85 },
  title: { size: 22, lineHeight: 26, weight: '600', letterSpacing: -0.7 },
  heading: { size: 15, lineHeight: 20, weight: '600' },
  body: { size: 14.5, lineHeight: 21, weight: '400' },
  secondary: { size: 13.5, lineHeight: 19, weight: '400' },
  label: { size: 12.5, lineHeight: 17, weight: '600' },
  control: { size: 14, lineHeight: 19, weight: '600' },
  value: { size: 15, lineHeight: 20, weight: '400' },
  // The console has no login splash and no brand moment. The step exists to
  // satisfy the shared type; nothing in `apps/console` renders it.
  brand: { size: 30, lineHeight: 36, weight: '500' },
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
  // UX polish: the console's danger button is critical text on the card surface, and a primary
  // button's label sits on the pressed accent while hovered.
  {
    name: 'critical text on surface',
    foreground: tokens.color.critical,
    background: tokens.color.surface,
    usage: 'text',
  },
  {
    name: 'primary button label on the pressed fill',
    foreground: tokens.color.onAccent,
    background: tokens.color.accentPressed,
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
  // FE-D7 2. The pressed grounds. A label stays on screen while a finger is on it, so each pressed
  // fill carries the same obligation as the fill it replaces.
  {
    name: 'primary text on the pressed wash',
    foreground: tokens.color.textPrimary,
    background: tokens.color.washPressed,
    usage: 'text',
  },
  {
    name: 'secondary text on the pressed wash',
    foreground: tokens.color.textSecondary,
    background: tokens.color.washPressed,
    usage: 'text',
  },
  {
    name: 'secondary text on the pressed success tint',
    foreground: tokens.color.textSecondary,
    background: tokens.color.successFillPressed,
    usage: 'text',
  },
  {
    name: 'hold-to-record label on the sage',
    foreground: tokens.color.textPrimary,
    background: tokens.color.sage,
    usage: 'text',
  },
  {
    name: 'hold-to-record label on the pressed sage, for the whole recording',
    foreground: tokens.color.textPrimary,
    background: tokens.color.sagePressed,
    usage: 'text',
  },
  {
    name: 'control border against the page',
    foreground: tokens.color.border,
    background: tokens.color.background,
    usage: 'non-text',
  },
];
