import type { ReactNode } from 'react';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { SignOut } from './sign-out';

/**
 * The admin sidebar.
 *
 * **Only the entry that has a screen behind it is a link.** The Phase 4 design
 * draws five admin destinations and one manager set; four of the admin five and
 * all of the manager side are unbuilt, so they render as plain text rather than as
 * links that go nowhere. A dead nav item teaches an admin the product is broken.
 *
 * The coaching queue arrived with the second §3.6 reversal on 3 September 2026 and
 * is the landing surface, as Phase 4 asks: "exception-first — not a team
 * scoreboard, because there isn't one."
 */
const ITEMS: readonly { readonly label: string; readonly href?: string }[] = [
  { label: 'Coaching queue', href: '/coaching' },
  // W1-A E3. A link, not plain text, because the screen behind it exists — the rule this list
  // already keeps. It is the operator's own destination under `C26`.
  { label: 'Knowledge approvals', href: '/knowledge' },
  // W1-F B. A link for the same reason: the screen exists. Until it did, a practice session could
  // not be started at all — `start_sim_session` refuses a scenario that is not approved, and
  // nothing but a test could approve one.
  { label: 'Practice doctors', href: '/practice' },
  { label: 'Consent versions', href: '/admin' },
  { label: 'Users & roles' },
  { label: 'Audit log' },
  { label: 'Territories' },
  { label: 'Retention & purge' },
];

/**
 * MR-52 A1: `signedInEmail` is whoever the request's cookie belongs to, or null before sign-in.
 * Rendered at the bottom so a shared machine shows whose console this is, with the way out beside it.
 */
export const Nav = ({
  signedInEmail = null,
}: { readonly signedInEmail?: string | null } = {}): ReactNode => (
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
    {signedInEmail === null ? null : (
      <div style={{ marginTop: 'auto', padding: `0 ${String(tokens.space.lg)}px` }}>
        <SignOut email={signedInEmail} />
      </div>
    )}
  </nav>
);
