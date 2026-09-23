'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';

/**
 * MR-52 A1 — signing out, beside whoever is signed in.
 *
 * A console that can be signed into and not out of is a shared computer with somebody else's
 * identity left on it — and this one reads employment data. `signOut()` clears the cookie both
 * halves read; `router.refresh()` makes the server re-render, which the middleware then sends to
 * the sign-in page.
 */
export const SignOut = ({ email }: { readonly email: string }): ReactNode => {
  const router = useRouter();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{ fontSize: compactTypography.label.size, color: tokens.color.textSecondary }}
        title={email}
      >
        {email}
      </span>
      <button
        onClick={() => {
          void browserClient()
            .auth.signOut()
            .then(() => {
              router.replace('/sign-in');
              router.refresh();
            });
        }}
        style={{
          padding: `6px ${String(tokens.space.sm)}px`,
          borderRadius: tokens.radius.control,
          border: `1px solid ${tokens.color.border}`,
          background: 'transparent',
          color: tokens.color.textPrimary,
          fontSize: compactTypography.control.size,
          cursor: 'pointer',
        }}
        type="button"
      >
        Sign out
      </button>
    </div>
  );
};
