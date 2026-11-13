import type { ReactNode } from 'react';
import { DM_Sans } from 'next/font/google';
import { Nav } from '../lib/nav';
import { TopBar } from '../lib/top-bar';
import { themeCss } from '../lib/theme-css';
import { signedIn } from '../lib/session';
import { callerRole } from '../lib/role';
import { RoleNote } from '../lib/ui';

/**
 * `FE-W169` — every tab says which page it is ("Coaching queue · Field Force"): each page exports
 * its own `metadata.title` and this template adds the product. The description was the first
 * screen's, "Consent versions, audit and retention", long after the console became more than that.
 */
export const metadata = {
  title: { default: 'Field Force', template: '%s · Field Force' },
  description:
    'The Field Force console: coaching, planning, live location and the team’s day for managers; content approvals and administration for admins.',
};

/**
 * DM Sans, the brand face, through `next/font` — part of Next, not a new dependency. It is
 * downloaded at build time and served from this app, so no request leaves for Google when a page
 * loads, and `display: swap` keeps text readable while it arrives.
 *
 * `FE-W122`. This file used to say DM Sans was not loaded because the field app registers four
 * separate faces through `expo-font` and the console had no equivalent. `next/font` is that
 * equivalent: one variable face covering every weight the compact scale uses (400–700), exposed
 * as `--ff-font-sans` for the stylesheet.
 */
const sans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--ff-font-sans' });

/**
 * The console shell.
 *
 * **The display name is not a brand name**, for the same reason `app.config.ts` in
 * the field app keeps it configurable: `docs/brand-identifier-decision.md` records
 * ELMIRON® as a third party's registered trademark, and the design's "Elmiron
 * Field" wordmark in the sidebar waits on that ruling rather than being typed in
 * here. The sidebar's mark is a glyph for that reason, not a wordmark.
 *
 * `FE-W121`: a sticky sidebar, a sticky top bar with the breadcrumb, and the page beneath — all
 * styled by the one stylesheet generated from the tokens (`theme-css.ts`).
 */
export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<ReactNode> {
  // MR-52 A1. Read per request, so the sidebar names whoever this browser is signed in as.
  const session = await signedIn();
  // `FE-W164`: the role decides what the sidebar OFFERS, nothing more (`role.ts`).
  const role = session === null ? null : await callerRole();
  return (
    <html className={sans.variable} lang="en">
      <head>
        {/* The console's whole visual layer -- generated from the tokens. */}
        <style>{themeCss}</style>
      </head>
      <body className="ff-body">
        <div className="ff-shell">
          {/*
            UX polish. No sidebar before sign-in: a signed-out visitor saw every admin destination,
            which read as reachable. The middleware still decides what is; this only stops the shell
            suggesting otherwise.
          */}
          {session === null ? (
            <main className="ff-main-bare">{children}</main>
          ) : (
            <>
              <Nav role={role} signedInEmail={session.email} />
              <div className="ff-column">
                <TopBar />
                <main className="ff-main">
                  {/*
                    `FE-W164`. A rep who signs in here is offered no destination, and is told why
                    rather than left with an empty sidebar. Every page still answers for itself.
                  */}
                  {role === 'mr' ? (
                    <div className="ff-page ff-page-gap">
                      <RoleNote>
                        This console is for managers and admins. Your own work — visits, learning
                        and practice — is in the Field Force app.
                      </RoleNote>
                    </div>
                  ) : null}
                  {children}
                </main>
              </div>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
