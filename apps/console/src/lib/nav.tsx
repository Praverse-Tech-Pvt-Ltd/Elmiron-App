'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import type { IconName } from './icons';
import { currentHref, navGroupsFor, roleName } from './nav-items';
import type { ConsoleRole } from './nav-items';
import { SignOut } from './sign-out';

/**
 * The console sidebar.
 *
 * **Only an entry with a screen behind it is a link.** A dead nav item teaches an admin the product
 * is broken. The coaching queue is the landing surface, as Phase 4 asks: "exception-first — not a
 * team scoreboard, because there isn't one."
 *
 * **UX polish.** Only the CURRENT page looks current (`aria-current="page"`); entries are grouped by
 * what the work is; nothing is drawn at a contrast below what the token tests guarantee.
 *
 * `FE-W79`: the "Coming later" section is gone because every entry under it was built. A future
 * unbuilt destination goes back under that heading, never as a dead link.
 *
 * `FE-W121`: the sidebar of a desk product — a brand mark, each entry with a glyph, the current page
 * lifted onto a card, and whoever is signed in at the foot. Under 1100px it folds to a rail of
 * glyphs; the words stay in the markup, so a link's accessible name never changes with the width.
 *
 * `FE-W164`: **each role is offered what works for it** (`nav-items.ts`). A manager saw all
 * seventeen entries and eight answered with a refusal; the brand line said "Admin" to a manager. The
 * role is read on the server (`role.ts`) and passed in. It is a courtesy: the database decides.
 *
 * `FE-W170`: **on a phone the rail becomes a bar.** Under 640px the 72px rail left about 300px for
 * the page, so the sidebar folds into a slim bar across the top — the brand mark, the role and a
 * Menu button that opens the full list with its words. The button is an ordinary disclosure
 * (`aria-expanded`, `aria-controls`); every link is a full page load, so the menu closes by itself.
 */

/** One glyph per destination, keyed by route. Decorative: the label names the entry. */
const ICONS: Readonly<Record<string, IconName>> = {
  '/coaching': 'inbox',
  '/reports': 'clipboard',
  '/exceptions': 'flag',
  '/planning': 'calendar',
  '/tracking': 'pin',
  '/days': 'clock',
  '/coverage': 'checks',
  '/learning': 'cap',
  '/knowledge': 'book',
  '/practice': 'pulse',
  '/practice-feedback': 'message',
  '/prompts': 'sparkle',
  '/courses': 'layers',
  '/admin': 'fileCheck',
  '/planning/access': 'key',
  '/tracking/notice': 'shield',
  '/adverse-events': 'bell',
  '/users': 'users',
  '/territories': 'map',
  '/audit': 'list',
  '/retention': 'archive',
};

/**
 * MR-52 A1: `signedInEmail` is whoever the request's cookie belongs to, or null before sign-in.
 * Rendered at the bottom so a shared machine shows whose console this is, with the way out beside it.
 */
export const Nav = ({
  signedInEmail = null,
  role = null,
}: {
  readonly signedInEmail?: string | null;
  readonly role?: ConsoleRole | null;
} = {}): ReactNode => {
  const current = currentHref(usePathname());
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Console" className="ff-nav" data-open={open ? 'true' : 'false'}>
      <div className="ff-nav-head">
        <div className="ff-brand">
          <span className="ff-brand-mark">
            <Icon name="leaf" size={18} strokeWidth={2} />
          </span>
          <span className="ff-nav-text">{roleName(role)}</span>
        </div>
        <button
          aria-controls="ff-nav-menu"
          aria-expanded={open}
          className="ff-nav-toggle"
          onClick={() => {
            setOpen(!open);
          }}
          type="button"
        >
          <Icon name={open ? 'close' : 'menu'} size={20} />
          <span>Menu</span>
        </button>
      </div>
      <div className="ff-nav-menu" id="ff-nav-menu">
        <div className="ff-nav-items">
          {navGroupsFor(role).map((group) => (
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
      </div>
    </nav>
  );
};
