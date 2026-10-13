import type { ReactNode } from 'react';
import { DM_Sans } from 'next/font/google';
import { Nav } from '../lib/nav';
import { TopBar } from '../lib/top-bar';
import { themeCss } from '../lib/theme-css';
import { signedIn } from '../lib/session';

export const metadata = {
  title: 'Field Force — admin',
  description: 'Consent versions, audit and retention.',
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
              <Nav signedInEmail={session.email} />
              <div className="ff-column">
                <TopBar />
                <main className="ff-main">{children}</main>
              </div>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
