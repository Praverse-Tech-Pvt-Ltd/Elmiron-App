/**
 * THE BRAND PALETTE, from `docs/design/phase1-tokens-and-components.dc.html`.
 *
 * This file used to hold seven neutral greys and one plain blue, marked placeholder
 * at every level, because the design had not been committed and inventing a palette
 * produces something that looks authoritative and is wrong in a way nobody catches
 * until the client sees it. Phase 1 is now in the repository, so these are the real
 * values and `tokens.status` reads `brand`.
 *
 * Names are Phase 1's own — `paper`, `card`, `wash`, `ink`, `muted`, `accent`,
 * `border`, `hairline` — so a value here traces back to the section of the design
 * that defines it, rather than to somebody's guess at what a `neutral600` was for.
 *
 * Two values that look like mistakes and are not:
 *
 * - **`recording` is terracotta, not signal red.** Phase 1 says so in as many words
 *   and Phase 3 gives the reason: a doctor glancing across the desk at a recording
 *   indicator should read "on", not "alarm". Signal red would make a lawful,
 *   consented recording look like a fault.
 * - **`offlineFill` is a wash and `offlineEdge` a neutral slate.** Offline is a
 *   normal working state, so it carries no warning colour anywhere.
 */

export const brandPalette = {
  // 01 — Ground
  /** Screen base. */
  paper: '#FBFAF7',
  /** Everything raised: cards, sheets, list rows. */
  card: '#FFFFFF',
  /** Recessed fill — inactive chips, secondary buttons, the offline state. */
  wash: '#F1EFE8',
  /** Pressed state for `wash`. */
  washPressed: '#E5E2D9',
  /** Primary type. */
  ink: '#1F211C',
  /** Everything not primary. Phase 1 bans a third grey. */
  muted: '#585B52',
  /** Control edges only. */
  border: '#8B8E84',
  /** Dividers inside a card. Decorative — no contrast obligation. */
  hairline: '#F2F0E9',

  // 02 — Semantic
  /** Primary action fill, and success. */
  accent: '#35593A',
  /** Pressed state for `accent`. */
  accentPressed: '#2F5233',
  /** Tint behind a success message. */
  successFill: '#E9F0E9',
  /** Attention — "battery saver is on". Not a failure. */
  attention: '#7A5510',
  attentionFill: '#F7EFDD',
  /** Genuine failures only. See the note on `critical` in `tokens.ts`. */
  critical: '#9C3B26',
  criticalFill: '#F8EAE6',
  info: '#2A5570',
  infoFill: '#E7EFF4',
  /** Offline. A wash and a slate — deliberately not amber and not red. */
  offlineFill: '#F1EFE8',
  offlineEdge: '#B4B7AC',
  /** Recording in progress. Terracotta by decision, not signal red. */
  recording: '#8A4A32',

  white: '#FFFFFF',
} as const;

export type PaletteColor = keyof typeof brandPalette;
