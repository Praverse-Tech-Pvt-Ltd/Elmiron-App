'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import type { IconName } from './icons';
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
 *
 * `FE-W79`: the last four "Coming later" entries were built, so the section is gone rather than
 * left empty. A future unbuilt destination goes back under that heading, never as a dead link.
 *
 * `FE-W121`: the sidebar of a desk product — a brand mark, each entry with a glyph, the current
 * page lifted onto a card, and whoever is signed in at the foot. Under 1100px it folds to a rail of
 * glyphs; the words stay in the markup, so a link's accessible name never changes with the width.
 */
interface NavItem {
  readonly label: string;
  readonly href: string;
}

/** One glyph per destination, keyed by route. Decorative: the label names the entry. */
const ICONS: Readonly<Record<string, IconName>> = {
  '/coaching': 'inbox',
  '/planning': 'calendar',
  '/tracking': 'pin',
  '/days': 'clock',
  '/learning': 'cap',
  '/knowledge': 'book',
  '/practice': 'pulse',
  '/practice-feedback': 'message',
  '/prompts': 'sparkle',
  '/courses': 'layers',
  '/admin': 'fileCheck',
  '/planning/access': 'key',
  '/tracking/notice': 'shield',
  '/users': 'users',
  '/territories': 'map',
  '/audit': 'list',
  '/retention': 'archive',
};

export const GROUPS: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  {
    title: 'Team',
    items: [
      { label: 'Coaching queue', href: '/coaching' },
      // `BE-W171` / `BE-C78`. The manager plans a rep's day; the screen refuses, in words, the role
      // it is not for.
      { label: 'Plan a rep’s day', href: '/planning' },
      // `FE-W72` / `BE-W180`. Reps' latest positions and today's list; the admin's company switch.
      { label: 'Live location', href: '/tracking' },
      // `BE-W191`. Who started and ended their day, and reopening an ended one, with a reason.
      { label: 'The team’s day', href: '/days' },
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
      // `FE-W91` / `BE-W201`. The company's own live location notice, loaded and approved by two admins.
      { label: 'Live location notice', href: '/tracking/notice' },
    ],
  },
  {
    // `FE-W75`–`FE-W78`. The four that sat under "Coming later": each now has a screen and the
    // database functions behind it (`BE-W185`–`BE-W189`).
    title: 'Administration',
    items: [
      { label: 'Users & roles', href: '/users' },
      { label: 'Territories', href: '/territories' },
      { label: 'Audit log', href: '/audit' },
      { label: 'Retention & purge', href: '/retention' },
    ],
  },
];

/** The most specific link that contains the current path is the current one. */
export const currentHref = (pathname: string): string | null => {
  const all = GROUPS.flatMap((group) => group.items.map((item) => item.href));
  const matches = all.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
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
    <nav aria-label="Console" className="ff-nav">
      <div className="ff-brand">
        <span className="ff-brand-mark">
          <Icon name="leaf" size={18} strokeWidth={2} />
        </span>
        <span className="ff-nav-text">Admin</span>
      </div>
      <div className="ff-nav-items">
        {GROUPS.map((group) => (
          <div className="ff-nav-group" key={group.title}>
            <div className="ff-nav-title">{group.title}</div>
            {group.items.map((item) => (
              <a
                aria-current={item.href === current ? 'page' : undefined}
                className="ff-nav-link"
                href={item.href}
                key={item.href}
                title={item.label}
              >
                <Icon name={ICONS[item.href] ?? 'list'} />
                <span className="ff-nav-text">{item.label}</span>
              </a>
            ))}
          </div>
        ))}
      </div>
      {signedInEmail === null ? null : (
        <div className="ff-nav-foot">
          <SignOut email={signedInEmail} />
        </div>
      )}
    </nav>
  );
};
