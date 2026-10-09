import { compactTypography, tokens } from '@fieldforce/ui-tokens';

/**
 * UX polish — the console's states, which inline styles cannot express.
 *
 * Every page is inline `style={{}}` (see `ui.tsx`), so there was no hover, no keyboard focus
 * ring, no disabled look and no breakpoint anywhere in the console: a disabled "Approve" looked
 * exactly like an enabled one, and a keyboard user could not see where they were. This is the one
 * stylesheet, GENERATED from the same tokens, so it cannot introduce a colour or a size the token
 * tests have not checked. Rendered once by the root layout.
 */
const px = (n: number): string => `${String(n)}px`;
const c = tokens.color;
const t = compactTypography;

export const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'quiet'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** The class list for a console button. Every button in the console takes one of these. */
export const btn = (variant: ButtonVariant = 'secondary'): string => `ff-btn ff-btn-${variant}`;

export const themeCss = `
:root { color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }

.ff-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: ${px(tokens.space.xs)};
  min-height: 40px; padding: 0 ${px(tokens.space.md)};
  border-radius: ${px(tokens.radius.md)}; border: 1px solid ${c.border};
  background: ${c.surface}; color: ${c.textPrimary};
  font: inherit; font-size: ${px(t.body.size)}; font-weight: 600; line-height: 1.2;
  cursor: pointer; white-space: nowrap;
  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.ff-btn:hover:not(:disabled) { background: ${c.wash}; }
.ff-btn:active:not(:disabled) { background: ${c.washPressed}; }
.ff-btn-primary { background: ${c.accent}; border-color: ${c.accent}; color: ${c.onAccent}; }
.ff-btn-primary:hover:not(:disabled) { background: ${c.accentPressed}; border-color: ${c.accentPressed}; }
.ff-btn-primary:active:not(:disabled) { background: ${c.accentPressed}; }
.ff-btn-danger { color: ${c.critical}; border-color: ${c.critical}; }
.ff-btn-danger:hover:not(:disabled) { background: ${c.criticalFill}; }
.ff-btn-quiet { border-color: transparent; background: transparent; }
.ff-btn:disabled { opacity: 0.45; cursor: not-allowed; }

a, button, input, select, textarea, summary { outline: none; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible,
textarea:focus-visible, summary:focus-visible {
  outline: 2px solid ${c.accent}; outline-offset: 2px;
}

.ff-nav-link { color: ${c.textPrimary}; text-decoration: none; border-radius: ${px(tokens.radius.md)}; }
.ff-nav-link:hover { background: ${c.washPressed}; }
.ff-nav-link[aria-current='page'] {
  background: ${c.surface}; color: ${c.accent}; box-shadow: inset 3px 0 0 ${c.accent};
}

.ff-table tbody tr:hover td { background: ${c.background}; }

@media (max-width: 900px) {
  .ff-shell { flex-direction: column; }
  .ff-nav { width: auto !important; }
  .ff-nav-items { flex-direction: row !important; flex-wrap: wrap; }
  .ff-main { padding: ${px(tokens.space.md)} !important; }
}
`;
