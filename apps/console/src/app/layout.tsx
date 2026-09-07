import type { ReactNode } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { Nav } from '../lib/nav';

export const metadata = {
  title: 'Field Force — admin',
  description: 'Consent versions, audit and retention.',
};

/**
 * The console shell.
 *
 * **The display name is not a brand name**, for the same reason `app.config.ts` in
 * the field app keeps it configurable: `docs/brand-identifier-decision.md` records
 * ELMIRON® as a third party's registered trademark, and the design's "Elmiron
 * Field" wordmark in the sidebar waits on that ruling rather than being typed in
 * here.
 *
 * DM Sans is not loaded. The field app registers four faces through `expo-font`;
 * doing the equivalent here means `next/font` and a decision about self-hosting,
 * and shipping a half-applied typeface would be worse than the honest system stack
 * this falls back to. Recorded in `docs/fe-w3-spec.md` with the rest of Phase 4.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: tokens.color.background,
          color: tokens.color.textPrimary,
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
        }}
      >
        <Nav />
        <main style={{ flex: 1, padding: tokens.space.xl, overflow: 'auto' }}>{children}</main>
      </body>
    </html>
  );
}
