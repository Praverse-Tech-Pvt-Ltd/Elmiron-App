'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
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
 *
 * **UX polish.** Three changes:
 * - Only the CURRENT page looks current (`aria-current="page"`). Every link used to carry the
 *   active treatment — accent text, a tint and an inset bar — so ten bars in a column said
 *   nothing about where you were.
 * - Grouped by what the work is: the team's daily work first, then content waiting for a second
 *   admin, then governance. Daily operational links no longer sit in one list with configuration.
 * - Unbuilt entries are named under "Coming later" in full-contrast muted text. They were drawn
 *   at 60% opacity — below the contrast the token tests guarantee — with the explanation only in
 *   a hover tooltip no keyboard or touch could reach.
 */
interface NavItem {
  readonly label: string;
  readonly href: string;
}

const GROUPS: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  {
    title: 'Team',
    items: [
      { label: 'Coaching queue', href: '/coaching' },
      // `BE-W171` / `BE-C78`. The manager plans a rep's day; the screen refuses, in words, the role
      // it is not for.
      { label: 'Plan a rep’s day', href: '/planning' },
      // W2-G B (OP-6). The screen `assign_course` waited for: a rep's Learning shows only assigned courses.
      { label: 'Course assignments', href: '/learning' },
    ],
  },
  {
    title: 'Content approvals',
    items: [
      // W1-A E3. The operator's own destination under `C26`.
      { label: 'Knowledge', href: '/knowledge' },
      // W1-F B. Until this existed a practice session could not be started at all.
      { label: 'Practice doctors', href: '/practice' },
      // The AI coach's analysis of practice sessions. Admins only (RLS); never a manager's.
      { label: 'Practice feedback', href: '/practice-feedback' },
      // W1-G E1 / BE-W122. Before this route, the only way to create a prompt was SQL.
      { label: 'AI prompts', href: '/prompts' },
      // Publishing a loaded course version, which only `content-step.mjs` could do.
      { label: 'Courses', href: '/courses' },
    ],
  },
  {
    title: 'Governance',
    items: [
      { label: 'Consent versions', href: '/admin' },
      { label: 'Planning access', href: '/planning/access' },
    ],
  },
];

const COMING_LATER: readonly string[] = [
  'Users & roles',
  'Audit log',
  'Territories',
  'Retention & purge',
];

/** The most specific link that contains the current path is the current one. */
const currentHref = (pathname: string): string | null => {
  const all = GROUPS.flatMap((group) => group.items.map((item) => item.href));
  const matches = all.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
};

const groupTitle = {
  fontSize: compactTypography.label.size,
  fontWeight: 600,
  color: tokens.color.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  padding: `${String(tokens.space.md)}px ${String(tokens.space.sm)}px ${String(tokens.space.xs)}px`,
};

const linkStyle = {
  display: 'block',
  padding: `${String(tokens.space.sm)}px ${String(tokens.space.sm)}px`,
  fontSize: compactTypography.body.size,
};

/**
 * MR-52 A1: `signedInEmail` is whoever the request's cookie belongs to, or null before sign-in.
 * Rendered at the bottom so a shared machine shows whose console this is, with the way out beside it.
 */
export const Nav = ({
  signedInEmail = null,
}: { readonly signedInEmail?: string | null } = {}): ReactNode => {
  const current = currentHref(usePathname());
  return (
    <nav
      aria-label="Console"
      className="ff-nav"
      style={{
        width: 232,
        flex: 'none',
        background: tokens.color.wash,
        padding: `${String(tokens.space.lg)}px ${String(tokens.space.sm)}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.xs,
      }}
    >
      <div
        style={{
          padding: `0 ${String(tokens.space.sm)}px ${String(tokens.space.sm)}px`,
          fontSize: compactTypography.heading.size,
          fontWeight: Number(compactTypography.heading.weight),
        }}
      >
        Admin
      </div>
      <div className="ff-nav-items" style={{ display: 'flex', flexDirection: 'column' }}>
        {GROUPS.map((group) => (
          <div key={group.title}>
            <div style={groupTitle}>{group.title}</div>
            {group.items.map((item) => (
              <a
                aria-current={item.href === current ? 'page' : undefined}
                className="ff-nav-link"
                href={item.href}
                key={item.href}
                style={linkStyle}
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
        <div>
          <div style={groupTitle}>Coming later</div>
          {COMING_LATER.map((label) => (
            <span
              key={label}
              style={{ ...linkStyle, color: tokens.color.textSecondary, cursor: 'default' }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      {signedInEmail === null ? null : (
        <div
          style={{
            marginTop: 'auto',
            padding: `${String(tokens.space.md)}px ${String(tokens.space.sm)}px 0`,
          }}
        >
          <SignOut email={signedInEmail} />
        </div>
      )}
    </nav>
  );
};
