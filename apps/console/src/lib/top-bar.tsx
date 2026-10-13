'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { GROUPS, currentHref } from './nav';

/**
 * `FE-W121` — the top bar: where this page sits in the console, as a breadcrumb.
 *
 * **It says nothing the sidebar does not.** The words are the sidebar's own group and entry
 * labels, so the bar adds no copy and cannot drift from the navigation. A page beneath an entry
 * (an analysis under the coaching queue) shows the entry as a link back to it.
 *
 * Not a heading: each page's `<h1>` is its title, and a second heading with the same words would
 * be announced twice.
 */
export const TopBar = (): ReactNode => {
  const pathname = usePathname();
  const href = currentHref(pathname);
  const group = GROUPS.find((g) => g.items.some((item) => item.href === href));
  const item = group?.items.find((i) => i.href === href);
  if (group === undefined || item === undefined) return <div className="ff-topbar" />;
  const deeper = pathname !== item.href;
  return (
    <div className="ff-topbar">
      <nav aria-label="Breadcrumb">
        <ol className="ff-crumbs">
          <li>
            <span className="ff-crumb">{group.title}</span>
          </li>
          <li>
            {deeper ? (
              <a className="ff-crumb" href={item.href}>
                {item.label}
              </a>
            ) : (
              <span aria-current="page" className="ff-crumb">
                {item.label}
              </span>
            )}
          </li>
        </ol>
      </nav>
    </div>
  );
};
