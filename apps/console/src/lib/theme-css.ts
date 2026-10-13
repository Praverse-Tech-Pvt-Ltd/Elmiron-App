import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import type { TypeStyle } from '@fieldforce/ui-tokens';

/**
 * The console's design system, as ONE stylesheet generated from the tokens.
 *
 * UX polish introduced this file for the states inline styles cannot express (hover, focus,
 * disabled, a breakpoint). `FE-W120` makes it the console's whole visual layer: every page used
 * to restate its own field, table and header styles inline, so no two screens agreed on a radius
 * or a padding. Now the elements are styled here once, by class and by semantic element, and
 * (`FE-W123`) the pages carry layout only.
 *
 * **Nothing here invents a colour.** Every colour is a `tokens.color` entry, exposed as a CSS
 * custom property (`--ff-text-primary`, `--ff-accent`, …) generated from the token object itself,
 * so a token added in `ui-tokens` reaches the console without an edit here. The only derived
 * values are translucent versions of a token (`alpha()`): the ink at 6% for a shadow, the paper
 * at 86% behind the frosted top bar. A derived value is never used for text, so it can never
 * create an unchecked contrast pair.
 */
const px = (n: number): string => `${String(n)}px`;
const c = tokens.color;
const t = compactTypography;
const s = tokens.space;
const r = tokens.radius;

/** `#35593A` at `a` opacity, as `rgba()`. Only for shadows, rings and tints — never for text. */
export const alpha = (hex: string, a: number): string => {
  const value = hex.replace('#', '');
  const channel = (i: number): number => Number.parseInt(value.slice(i, i + 2), 16);
  return `rgba(${String(channel(0))}, ${String(channel(2))}, ${String(channel(4))}, ${String(a)})`;
};

/** `textPrimary` → `--ff-text-primary`. */
const kebab = (name: string): string => name.replace(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`);

const colourVars = (Object.entries(c) as [string, string][])
  .map(([name, value]) => `  --ff-${kebab(name)}: ${value};`)
  .join('\n');

const typeRule = (style: TypeStyle): string =>
  [
    `font-size: ${px(style.size)}`,
    `line-height: ${px(style.lineHeight)}`,
    `font-weight: ${style.weight}`,
    ...(style.letterSpacing === undefined ? [] : [`letter-spacing: ${px(style.letterSpacing)}`]),
  ].join('; ');

/** The select's chevron, drawn in the secondary text colour. */
const chevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(c.textSecondary)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'quiet'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** The class list for a console button. Every button in the console takes one of these. */
export const btn = (variant: ButtonVariant = 'secondary'): string => `ff-btn ff-btn-${variant}`;

/** The height of the sticky top bar; table headers stick beneath it. */
const TOPBAR = 56;

export const themeCss = `
:root {
  color-scheme: light;
${colourVars}
  --ff-edge: ${alpha(c.textPrimary, 0.08)};
  --ff-edge-strong: ${alpha(c.textPrimary, 0.14)};
  --ff-shadow-xs: 0 1px 2px ${alpha(c.textPrimary, 0.05)};
  --ff-shadow-sm: 0 1px 2px ${alpha(c.textPrimary, 0.04)}, 0 2px 6px -2px ${alpha(c.textPrimary, 0.06)};
  --ff-shadow-md: 0 1px 3px ${alpha(c.textPrimary, 0.05)}, 0 8px 24px -8px ${alpha(c.textPrimary, 0.12)};
  --ff-ring: 0 0 0 3px ${alpha(c.accent, 0.18)};
  --ff-radius-control: ${px(r.md)};
  --ff-radius-well: ${px(r.well)};
  --ff-radius-card: ${px(r.control)};
  --ff-topbar-h: ${px(TOPBAR)};
  --ff-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ff-fast: 160ms;
  --ff-font-ui: var(--ff-font-sans, ui-sans-serif), system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ff-font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }

body.ff-body {
  margin: 0; min-height: 100vh;
  background: var(--ff-background); color: var(--ff-text-primary);
  font-family: var(--ff-font-ui); ${typeRule(t.body)};
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
::selection { background: var(--ff-success-fill-pressed); color: var(--ff-text-primary); }

/* ---------------------------------------------------------------- the shell */

.ff-shell { display: flex; min-height: 100vh; }
.ff-column { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ff-main { flex: 1; min-width: 0; padding: ${px(s.lg + s.xs)} ${px(s.xl)} ${px(s.xl * 2)}; }
.ff-main-bare { flex: 1; min-width: 0; display: flex; }

.ff-nav {
  position: sticky; top: 0; height: 100vh; width: 248px; flex: none;
  display: flex; flex-direction: column; gap: ${px(s.xs)};
  padding: ${px(s.md)} ${px(s.sm + s.xs)} ${px(s.sm + s.xs)};
  background: var(--ff-wash); border-right: 1px solid var(--ff-edge);
  overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--ff-edge-strong) transparent;
}
.ff-brand {
  display: flex; align-items: center; gap: ${px(s.sm + s.xs / 2)};
  padding: ${px(s.xs)} ${px(s.sm)} ${px(s.sm + s.xs)};
  ${typeRule(t.heading)}; color: var(--ff-text-primary);
}
.ff-brand-mark {
  width: 32px; height: 32px; flex: none; display: grid; place-items: center;
  border-radius: ${px(r.md + 2)}; background: var(--ff-accent); color: var(--ff-on-accent);
  box-shadow: inset 0 1px 0 ${alpha(c.onAccent, 0.16)}, var(--ff-shadow-xs);
}
.ff-brand-mark-lg { width: 40px; height: 40px; border-radius: ${px(r.well)}; }
.ff-nav-items { display: flex; flex-direction: column; gap: ${px(s.xs / 2)}; }
.ff-nav-group { display: flex; flex-direction: column; gap: 2px; }
.ff-nav-group + .ff-nav-group { margin-top: ${px(s.sm)}; }
.ff-nav-title {
  padding: ${px(s.xs)} ${px(s.sm + s.xs / 2)} ${px(s.xs)};
  font-size: ${px(t.label.size - 1.5)}; line-height: ${px(t.label.lineHeight)}; font-weight: 600;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ff-text-secondary);
}
.ff-nav-link {
  display: flex; align-items: center; gap: ${px(s.sm + s.xs / 2)};
  min-height: 32px; padding: ${px(s.xs + 1)} ${px(s.sm + s.xs / 2)};
  border-radius: ${px(r.md)}; color: var(--ff-text-primary); text-decoration: none;
  font-size: ${px(t.body.size - 0.5)}; line-height: 1.25; font-weight: 500;
  transition: background-color var(--ff-fast) var(--ff-ease), color var(--ff-fast) var(--ff-ease),
    box-shadow var(--ff-fast) var(--ff-ease);
}
.ff-nav-link svg { flex: none; color: var(--ff-text-secondary); transition: color var(--ff-fast) var(--ff-ease); }
.ff-nav-link:hover { background: var(--ff-wash-pressed); }
.ff-nav-link:active { background: var(--ff-wash-pressed); }
.ff-nav-link[aria-current='page'] {
  background: var(--ff-surface); color: var(--ff-accent); font-weight: 600;
  box-shadow: var(--ff-shadow-sm), inset 0 0 0 1px var(--ff-edge);
}
.ff-nav-link[aria-current='page'] svg { color: var(--ff-accent); }
.ff-nav-foot { margin-top: auto; padding-top: ${px(s.md)}; }
.ff-user {
  display: flex; flex-direction: column; gap: ${px(s.sm + s.xs / 2)};
  padding: ${px(s.sm + s.xs)}; border-radius: ${px(r.well)};
  background: var(--ff-surface); box-shadow: var(--ff-shadow-xs), inset 0 0 0 1px var(--ff-edge);
}
.ff-user-id { display: flex; align-items: center; gap: ${px(s.sm + s.xs / 2)}; min-width: 0; }
.ff-avatar {
  width: 32px; height: 32px; flex: none; display: grid; place-items: center;
  border-radius: 50%; background: var(--ff-success-fill); color: var(--ff-success);
  font-size: ${px(t.label.size)}; font-weight: 700; text-transform: uppercase;
}
.ff-user-email {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: ${px(t.label.size)}; line-height: ${px(t.label.lineHeight)}; color: var(--ff-text-secondary);
}
.ff-user .ff-btn { align-self: stretch; }

.ff-topbar {
  position: sticky; top: 0; z-index: 20; height: var(--ff-topbar-h);
  display: flex; align-items: center; gap: ${px(s.md)}; padding: 0 ${px(s.xl)};
  background: ${alpha(c.background, 0.86)};
  -webkit-backdrop-filter: saturate(1.4) blur(10px); backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--ff-edge);
}
.ff-crumbs { display: flex; align-items: center; gap: ${px(s.xs + 2)}; min-width: 0; margin: 0; padding: 0; list-style: none; }
.ff-crumbs li { display: flex; align-items: center; gap: ${px(s.xs + 2)}; min-width: 0; white-space: nowrap; }
.ff-crumbs li + li::before {
  content: ''; width: 6px; height: 6px; flex: none; margin-right: 2px;
  border-top: 1.5px solid var(--ff-text-secondary); border-right: 1.5px solid var(--ff-text-secondary);
  transform: rotate(45deg); opacity: 0.7;
}
.ff-crumb { font-size: ${px(t.secondary.size)}; color: var(--ff-text-secondary); text-decoration: none; }
a.ff-crumb:hover { color: var(--ff-text-primary); }
.ff-crumb[aria-current='page'] { color: var(--ff-text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }

/* ---------------------------------------------------------------- page structure */

.ff-page { display: flex; flex-direction: column; gap: ${px(s.lg)}; width: 100%; max-width: 1320px; margin: 0; }
.ff-page-medium { max-width: 1100px; }
.ff-page-narrow { max-width: 900px; }
.ff-page-header {
  display: flex; align-items: flex-end; justify-content: space-between; gap: ${px(s.md)};
  flex-wrap: wrap; padding-bottom: ${px(s.xs)};
}
.ff-page-header-text { display: flex; flex-direction: column; gap: ${px(s.xs + 2)}; min-width: 0; max-width: 80ch; }
.ff-page > .ff-page-header-text { padding-bottom: ${px(s.xs)}; }
.ff-page-actions { display: flex; gap: ${px(s.sm)}; align-items: center; flex-wrap: wrap; }
.ff-stack { display: flex; flex-direction: column; gap: ${px(s.md)}; min-width: 0; }
.ff-stack-sm { gap: ${px(s.sm)}; }
.ff-stack-lg { gap: ${px(s.lg)}; }
.ff-cell-stack { display: flex; flex-direction: column; gap: ${px(s.xs + 2)}; min-width: 0; }
.ff-row { display: flex; gap: ${px(s.sm)}; align-items: center; flex-wrap: wrap; }
.ff-row-tight { gap: ${px(s.xs + 2)}; }
.ff-prewrap { white-space: pre-wrap; }
td > .ff-note, td > .ff-btn + .ff-note { margin-top: ${px(s.sm)}; }
.ff-columns { display: flex; flex-wrap: wrap; gap: ${px(s.md)}; align-items: stretch; }
.ff-columns > * { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: ${px(s.md)}; }
.ff-columns > .ff-col-wide { flex-grow: 1.4; }
.ff-columns > * > .ff-card { flex: 1; }
.ff-split { display: flex; gap: ${px(s.lg)}; align-items: flex-start; }
.ff-split > .ff-split-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${px(s.md)}; }
.ff-split > .ff-split-side {
  width: 404px; flex: none; display: flex; flex-direction: column; gap: ${px(s.md)};
  position: sticky; top: calc(var(--ff-topbar-h) + ${px(s.md)});
}

/* ---------------------------------------------------------------- type */

.ff-title { margin: 0; color: var(--ff-text-primary); ${typeRule(t.display)}; text-wrap: balance; }
.ff-heading { margin: 0; color: var(--ff-text-primary); ${typeRule(t.heading)}; letter-spacing: -0.15px; }
.ff-text { margin: 0; color: var(--ff-text-primary); ${typeRule(t.body)}; text-wrap: pretty; }
.ff-text-muted { color: var(--ff-text-secondary); }
.ff-label { color: var(--ff-text-secondary); ${typeRule(t.label)}; }
.ff-eyebrow { display: block; margin-bottom: ${px(s.xs)}; }
.ff-figure { color: var(--ff-text-primary); ${typeRule(t.figure)}; font-variant-numeric: tabular-nums; }
.ff-muted { color: var(--ff-text-secondary); }
.ff-mono { font-family: var(--ff-font-mono); font-size: 0.92em; }
main strong { font-weight: 600; }

main a:not(.ff-btn):not(.ff-nav-link):not(.ff-crumb) {
  color: var(--ff-accent); font-weight: 500;
  text-decoration: underline; text-decoration-color: ${alpha(c.accent, 0.35)};
  text-decoration-thickness: 1px; text-underline-offset: 3px;
  transition: text-decoration-color var(--ff-fast) var(--ff-ease), color var(--ff-fast) var(--ff-ease);
}
main a:not(.ff-btn):not(.ff-nav-link):not(.ff-crumb):hover {
  color: var(--ff-accent-pressed); text-decoration-color: currentColor;
}
main code {
  font-family: var(--ff-font-mono); font-size: 0.95em; padding: 1px 6px;
  border-radius: ${px(r.sm + 2)}; background: var(--ff-surface); box-shadow: inset 0 0 0 1px var(--ff-edge-strong);
}

/* ---------------------------------------------------------------- surfaces */

.ff-card {
  background: var(--ff-surface); border-radius: var(--ff-radius-card);
  padding: ${px(s.lg)}; display: flex; flex-direction: column; gap: ${px(s.sm + s.xs)};
  min-width: 0; box-shadow: var(--ff-shadow-sm), 0 0 0 1px var(--ff-edge);
}
.ff-card > .ff-heading + .ff-text-muted { margin-top: -${px(s.xs)}; }
/* A label introduces the field after it: close to its own field, apart from the one before. */
.ff-card > .ff-label:not(:first-child) { margin-top: ${px(s.xs)}; }
.ff-card > .ff-label + :is(input, select, textarea) { margin-top: -${px(s.xs)}; }
/* A short answer gets a field sized to it; a long one (a textarea) keeps the full width. */
main .ff-card > select,
main .ff-card > input:not([type='checkbox']):not([type='radio']):not([type='hidden']) { max-width: 560px; }
.ff-well {
  background: var(--ff-wash); border-radius: var(--ff-radius-well);
  padding: ${px(s.md)}; display: flex; flex-direction: column; gap: ${px(s.xs)};
}
.ff-quote { border-left: 3px solid var(--ff-accent); border-top-left-radius: ${px(r.sm)}; border-bottom-left-radius: ${px(r.sm)}; }

.ff-notice-text { max-height: 420px; overflow-y: auto; }
.ff-map { display: block; border: 0; border-radius: var(--ff-radius-well); box-shadow: 0 0 0 1px var(--ff-edge); }
main code.ff-secret {
  font-size: ${px(t.heading.size)}; letter-spacing: 0.04em; padding: 2px ${px(s.sm)}; user-select: all;
}
.ff-cell-actions { min-width: 260px; }

/* A day's route: numbered stops, each on its own quiet row. */
.ff-route { margin: 0; padding: 0; list-style: none; counter-reset: stop; display: flex; flex-direction: column; gap: ${px(s.sm)}; }
.ff-route > li {
  counter-increment: stop; display: flex; align-items: center; gap: ${px(s.sm + s.xs)};
  padding: ${px(s.sm)} ${px(s.sm + s.xs)}; border-radius: var(--ff-radius-well);
  background: var(--ff-background); box-shadow: inset 0 0 0 1px var(--ff-edge);
}
.ff-route > li::before {
  content: counter(stop); flex: none; width: 24px; height: 24px; display: grid; place-items: center;
  border-radius: 50%; background: var(--ff-accent); color: var(--ff-on-accent);
  ${typeRule(t.label)}; font-variant-numeric: tabular-nums;
}
.ff-route-stop { flex: 1; min-width: 0; display: flex; gap: ${px(s.sm)}; align-items: center; flex-wrap: wrap; }
.ff-route-name { min-width: 220px; font-weight: 600; }

.ff-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: ${px(s.sm + s.xs)}; }
.ff-stat {
  display: flex; flex-direction: column; gap: ${px(s.xs)}; min-width: 0;
  padding: ${px(s.md)}; border-radius: var(--ff-radius-well);
  background: var(--ff-background); box-shadow: inset 0 0 0 1px var(--ff-edge);
}

/* ---------------------------------------------------------------- notes and pills */

.ff-note {
  display: flex; gap: ${px(s.sm + s.xs / 2)}; align-items: flex-start;
  border-radius: var(--ff-radius-well); padding: ${px(s.sm + s.xs)} ${px(s.md)};
  ${typeRule(t.secondary)};
}
.ff-note > svg { flex: none; margin-top: 1px; }
.ff-note-body { min-width: 0; flex: 1; }
.ff-note-attention { background: var(--ff-attention-fill); color: var(--ff-attention); box-shadow: inset 0 0 0 1px ${alpha(c.attention, 0.16)}; }
.ff-note-critical { background: var(--ff-critical-fill); color: var(--ff-critical); box-shadow: inset 0 0 0 1px ${alpha(c.critical, 0.22)}, inset 3px 0 0 var(--ff-critical); }
.ff-note-info { background: var(--ff-info-fill); color: var(--ff-info); box-shadow: inset 0 0 0 1px ${alpha(c.info, 0.14)}; }

.ff-pill {
  display: inline-flex; align-items: center; gap: ${px(s.xs + 2)}; white-space: nowrap;
  padding: 2px ${px(s.sm + 2)} 2px ${px(s.sm)}; border-radius: ${px(r.pill)};
  ${typeRule(t.label)}; vertical-align: middle;
}
.ff-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.85; }
.ff-pill-success { background: var(--ff-success-fill); color: var(--ff-success); }
.ff-pill-neutral { background: var(--ff-wash); color: var(--ff-text-secondary); }
.ff-pill-attention { background: var(--ff-attention-fill); color: var(--ff-attention); }
.ff-pill-info { background: var(--ff-info-fill); color: var(--ff-info); }
.ff-pill-critical { background: var(--ff-critical-fill); color: var(--ff-critical); }
.ff-pills { display: flex; gap: ${px(s.xs + 2)}; flex-wrap: wrap; align-items: center; }

/* ---------------------------------------------------------------- tables */

main table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  font-variant-numeric: tabular-nums;
}
main th {
  position: sticky; top: var(--ff-topbar-h); z-index: 1;
  text-align: left; vertical-align: bottom; white-space: nowrap;
  padding: ${px(s.sm + 2)} ${px(s.md)}; background: var(--ff-background);
  color: var(--ff-text-secondary); ${typeRule(t.label)};
  border-bottom: 1px solid var(--ff-edge);
}
main th:first-child { border-top-left-radius: ${px(r.md)}; }
main th:last-child { border-top-right-radius: ${px(r.md)}; }
main td {
  padding: ${px(s.sm + s.xs)} ${px(s.md)}; text-align: left; vertical-align: top;
  ${typeRule(t.body)}; color: var(--ff-text-primary);
  border-bottom: 1px solid var(--ff-edge);
  transition: background-color var(--ff-fast) var(--ff-ease);
}
main tbody tr:last-child td { border-bottom: 0; }
main tbody tr:hover td { background: ${alpha(c.background, 0.9)}; }
main th.ff-num, main td.ff-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
main td.ff-nowrap { white-space: nowrap; }
main td.ff-empty { padding: ${px(s.xl)} ${px(s.md)}; text-align: center; }
main td.ff-empty .ff-text { color: var(--ff-text-secondary); }

/* ---------------------------------------------------------------- buttons */

.ff-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: ${px(s.xs + 2)};
  min-height: 36px; padding: 0 ${px(s.md - 2)};
  border-radius: var(--ff-radius-control); border: 1px solid var(--ff-border);
  background: var(--ff-surface); color: var(--ff-text-primary);
  font: inherit; ${typeRule(t.control)}; text-decoration: none;
  cursor: pointer; white-space: nowrap; user-select: none;
  box-shadow: var(--ff-shadow-xs);
  /* A button is as wide as its words: in a column it does not stretch to the card's width. */
  align-self: flex-start;
  transition: background-color var(--ff-fast) var(--ff-ease), border-color var(--ff-fast) var(--ff-ease),
    color var(--ff-fast) var(--ff-ease), box-shadow var(--ff-fast) var(--ff-ease),
    transform var(--ff-fast) var(--ff-ease);
}
.ff-btn:hover:not(:disabled) { background: var(--ff-wash); }
.ff-btn:active:not(:disabled) { background: var(--ff-wash-pressed); transform: translateY(1px); box-shadow: none; }
.ff-btn-primary {
  background: var(--ff-accent); border-color: var(--ff-accent); color: var(--ff-on-accent);
  box-shadow: inset 0 1px 0 ${alpha(c.onAccent, 0.14)}, 0 1px 2px ${alpha(c.textPrimary, 0.16)};
}
.ff-btn-primary:hover:not(:disabled) { background: var(--ff-accent-pressed); border-color: var(--ff-accent-pressed); }
.ff-btn-primary:active:not(:disabled) { background: var(--ff-accent-pressed); }
.ff-btn-danger { color: var(--ff-critical); border-color: var(--ff-critical); }
.ff-btn-danger:hover:not(:disabled) { background: var(--ff-critical-fill); }
.ff-btn-danger:active:not(:disabled) { background: var(--ff-critical-fill); }
.ff-btn-quiet { border-color: transparent; background: transparent; box-shadow: none; }
.ff-btn:disabled {
  background: var(--ff-wash); border-color: var(--ff-wash); color: var(--ff-text-secondary);
  box-shadow: none; cursor: not-allowed;
}
.ff-btn-quiet:disabled { background: transparent; border-color: transparent; }
.ff-btn-block { align-self: stretch; min-height: 44px; }
.ff-btn-pair { display: flex; gap: ${px(s.sm)}; }
.ff-btn-pair > .ff-btn { flex: 1; min-height: 44px; }

/* ---------------------------------------------------------------- forms */

main input:not([type='checkbox']):not([type='radio']):not([type='hidden']),
main select, main textarea {
  font: inherit; ${typeRule(t.value)}; color: var(--ff-text-primary);
  min-height: 38px; max-width: 100%; padding: ${px(s.sm - 1)} ${px(s.sm + s.xs)};
  background: var(--ff-surface); border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius-control); box-shadow: var(--ff-shadow-xs);
  transition: border-color var(--ff-fast) var(--ff-ease), box-shadow var(--ff-fast) var(--ff-ease),
    background-color var(--ff-fast) var(--ff-ease);
}
main select {
  appearance: none; -webkit-appearance: none; cursor: pointer;
  padding-right: ${px(s.xl + s.xs)}; background-image: ${chevron};
  background-repeat: no-repeat; background-position: right ${px(s.sm + 2)} center; background-size: 16px;
}
main textarea { min-height: 96px; resize: vertical; line-height: 1.5; }
main input::placeholder, main textarea::placeholder { color: var(--ff-text-secondary); opacity: 1; }
main input:not([type='checkbox']):not([type='radio']):hover:not(:disabled):not(:focus),
main select:hover:not(:disabled):not(:focus), main textarea:hover:not(:disabled):not(:focus) {
  border-color: var(--ff-text-secondary);
}
main input:not([type='checkbox']):not([type='radio']):focus,
main select:focus, main textarea:focus {
  outline: 2px solid transparent; border-color: var(--ff-accent);
  box-shadow: 0 0 0 1px var(--ff-accent), var(--ff-ring);
}
main input:disabled, main select:disabled, main textarea:disabled {
  background-color: var(--ff-wash); color: var(--ff-text-secondary); box-shadow: none; cursor: not-allowed;
}
main [aria-invalid='true'] { border-color: var(--ff-critical) !important; }
main [aria-invalid='true']:focus { box-shadow: 0 0 0 1px var(--ff-critical), 0 0 0 3px ${alpha(c.critical, 0.16)} !important; }
main input[type='checkbox'], main input[type='radio'] {
  width: 16px; height: 16px; margin: 0; accent-color: var(--ff-accent); cursor: pointer; flex: none;
}
main label:has(> input[type='checkbox']), main label:has(> input[type='radio']) {
  display: inline-flex; align-items: center; gap: ${px(s.sm)}; cursor: pointer;
}
.ff-field { display: flex; flex-direction: column; gap: ${px(s.xs + 2)}; min-width: 0; }
.ff-filters { display: flex; gap: ${px(s.md)}; flex-wrap: wrap; align-items: flex-end; }

main details { border-radius: var(--ff-radius-well); }
main summary {
  display: inline-flex; align-items: center; gap: ${px(s.xs + 2)}; cursor: pointer; list-style: none;
  color: var(--ff-accent); font-weight: 600; border-radius: ${px(r.sm)};
}
main summary::-webkit-details-marker { display: none; }
main summary::before {
  content: ''; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform var(--ff-fast) var(--ff-ease); margin-right: 2px;
}
main details[open] > summary::before { transform: rotate(45deg); }
main details[open] > summary { margin-bottom: ${px(s.sm)}; }

/* ---------------------------------------------------------------- focus */

a, button, input, select, textarea, summary { outline: none; }
a:focus-visible, button:focus-visible, summary:focus-visible,
input[type='checkbox']:focus-visible, input[type='radio']:focus-visible {
  outline: 2px solid var(--ff-accent); outline-offset: 2px;
}

/* ---------------------------------------------------------------- loading */

.ff-skeleton {
  display: block; border-radius: ${px(r.md)};
  background: linear-gradient(90deg, var(--ff-wash) 0%, var(--ff-hairline) 50%, var(--ff-wash) 100%);
  background-size: 200% 100%; animation: ff-shimmer 1.4s ease-in-out infinite;
}
@keyframes ff-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.ff-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* ---------------------------------------------------------------- sign-in */

.ff-signin { flex: 1; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); min-height: 100vh; }
.ff-signin-brand {
  position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;
  padding: ${px(s.xl + s.md)}; background: var(--ff-wash); border-right: 1px solid var(--ff-edge);
}
.ff-signin-brand::before {
  content: ''; position: absolute; inset: auto -20% -30% -20%; height: 70%;
  background: radial-gradient(ellipse at 30% 100%, ${alpha(c.sage, 0.55)} 0%, ${alpha(c.sage, 0)} 65%);
  pointer-events: none;
}
.ff-signin-brand > * { position: relative; }
.ff-brand-line {
  margin: 0; max-width: 11em; color: var(--ff-accent); text-wrap: balance;
  font-family: var(--ff-font-brand), Georgia, serif; font-weight: ${tokens.typography.brand.weight};
  font-size: clamp(${px(tokens.typography.brand.size)}, 4.2vw, 56px); line-height: 1.08; letter-spacing: -0.01em;
}
.ff-signin-form { display: flex; align-items: center; justify-content: center; padding: ${px(s.xl)} ${px(s.lg)}; }
.ff-signin-panel { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: ${px(s.md)}; }
.ff-signin-panel .ff-card { padding: ${px(s.lg + s.xs)}; box-shadow: var(--ff-shadow-md), 0 0 0 1px var(--ff-edge); }
.ff-signin-panel form { display: flex; flex-direction: column; gap: ${px(s.md)}; }
.ff-signin-panel .ff-btn { align-self: stretch; min-height: 44px; }

/* ---------------------------------------------------------------- tablet */

@media (max-width: 1100px) {
  .ff-nav { width: 72px; padding-left: ${px(s.sm + s.xs / 2)}; padding-right: ${px(s.sm + s.xs / 2)}; align-items: stretch; }
  .ff-brand { justify-content: center; padding-left: 0; padding-right: 0; }
  .ff-nav-text, .ff-user-email { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  .ff-nav-title { height: 1px; padding: 0; margin: ${px(s.sm)} ${px(s.xs)}; background: var(--ff-edge-strong); font-size: 0; overflow: hidden; }
  .ff-nav-group + .ff-nav-group { margin-top: 0; }
  .ff-nav-link { justify-content: center; padding: ${px(s.sm)}; }
  .ff-user { padding: ${px(s.xs + 2)}; align-items: center; background: transparent; box-shadow: none; }
  .ff-user .ff-btn { padding: 0; width: 36px; align-self: center; }
  .ff-topbar, .ff-main { padding-left: ${px(s.lg)}; padding-right: ${px(s.lg)}; }
  .ff-card { overflow-x: auto; }
  main th { position: static; }
  main th, main td { padding-left: ${px(s.sm + s.xs)}; padding-right: ${px(s.sm + s.xs)}; }
  .ff-split { flex-direction: column; }
  .ff-split > .ff-split-side { width: 100%; position: static; }
  .ff-signin { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .ff-signin-brand { padding: ${px(s.lg)}; border-right: 0; border-bottom: 1px solid var(--ff-edge); gap: ${px(s.lg)}; }
  .ff-brand-line { max-width: none; }
}
@media (max-width: 640px) {
  .ff-topbar, .ff-main { padding-left: ${px(s.md)}; padding-right: ${px(s.md)}; }
  .ff-card { padding: ${px(s.md)}; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
  .ff-btn:active:not(:disabled) { transform: none; }
}
@media (forced-colors: active) {
  .ff-card, .ff-note, .ff-user { border: 1px solid CanvasText; }
  .ff-nav-link[aria-current='page'] { outline: 2px solid Highlight; }
}
`;
