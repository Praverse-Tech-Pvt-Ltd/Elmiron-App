'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { browserClient } from './supabase';
import { btn } from './theme-css';

/**
 * MR-52 A1 — signing out, beside whoever is signed in.
 *
 * A console that can be signed into and not out of is a shared computer with somebody else's
 * identity left on it — and this one reads employment data. `signOut()` clears the cookie both
 * halves read; `router.refresh()` makes the server re-render, which the middleware then sends to
 * the sign-in page.
 *
 * `FE-W121`: drawn as the sidebar's identity block — the first letter of the address on a disc,
 * the address beside it, and the way out under both. The words are unchanged and stay in the
 * markup when the rail hides them, so the button is still named "Sign out".
 */
export const SignOut = ({ email }: { readonly email: string }): ReactNode => {
  const router = useRouter();
  return (
    <div className="ff-user">
      <div className="ff-user-id">
        <span aria-hidden="true" className="ff-avatar">
          {email.slice(0, 1)}
        </span>
        <span className="ff-user-email" title={email}>
          {email}
        </span>
      </div>
      <button
        className={btn('secondary')}
        onClick={() => {
          void browserClient()
            .auth.signOut()
            .then(() => {
              router.replace('/sign-in');
              router.refresh();
            });
        }}
        title="Sign out"
        type="button"
      >
        <Icon name="signOut" size={16} />
        <span className="ff-nav-text">Sign out</span>
      </button>
    </div>
  );
};
