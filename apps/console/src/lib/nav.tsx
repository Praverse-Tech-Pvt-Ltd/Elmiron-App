import type { ReactNode } from 'react';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';

/**
 * The admin sidebar.
 *
 * **Only the entry that has a screen behind it is a link.** The Phase 4 design
 * draws five admin destinations and one manager set; four of the admin five and
 * all of the manager side are unbuilt, so they render as plain text rather than as
 * links that go nowhere. A dead nav item teaches an admin the product is broken.
 *
 * The manager console — the coaching queue and the analysis review — is absent
 * entirely rather than greyed out, because it is not merely unbuilt: `§3.6` still
 * forbids a screen that displays an analysis to a manager, and the 3 September
 * decision reopened only the MR's own screens.
 */
const ITEMS: readonly { readonly label: string; readonly href?: string }[] = [
  { label: 'Users & roles' },
  { label: 'Consent versions', href: '/admin' },
  { label: 'Audit log' },
  { label: 'Territories' },
  { label: 'Retention & purge' },
];

export const Nav = (): ReactNode => (
  <nav
    style={{
      width: 224,
      flex: 'none',
      background: tokens.color.wash,
      padding: `${String(tokens.space.lg)}px 0`,
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space.xs,
    }}
  >
    <div
      style={{
        padding: `0 ${String(tokens.space.lg)}px ${String(tokens.space.lg)}px`,
        fontSize: compactTypography.heading.size,
        fontWeight: Number(compactTypography.heading.weight),
      }}
    >
      Admin
    </div>
    {ITEMS.map((item) =>
      item.href === undefined ? (
        <span
          key={item.label}
          style={{
            padding: `${String(tokens.space.sm)}px ${String(tokens.space.lg)}px`,
            fontSize: compactTypography.body.size,
            color: tokens.color.textSecondary,
            opacity: 0.6,
          }}
          title="Not built yet"
        >
          {item.label}
        </span>
      ) : (
        <a
          href={item.href}
          key={item.label}
          style={{
            padding: `${String(tokens.space.sm)}px ${String(tokens.space.lg)}px`,
            fontSize: compactTypography.body.size,
            fontWeight: Number(compactTypography.heading.weight),
            color: tokens.color.accent,
            background: tokens.color.successFill,
            boxShadow: `inset 3px 0 0 ${tokens.color.accent}`,
            textDecoration: 'none',
          }}
        >
          {item.label}
        </a>
      ),
    )}
  </nav>
);
