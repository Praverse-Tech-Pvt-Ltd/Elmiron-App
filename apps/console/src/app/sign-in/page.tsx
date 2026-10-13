'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '../../lib/icons';
import { Body, Card, MissingNote, Title } from '../../lib/ui';
import { browserClient } from '../../lib/supabase';
import { btn } from '../../lib/theme-css';

/**
 * MR-52 A1 — the console's sign-in. `FE-W66`.
 *
 * **The same account as the app** (`D-14`): one `auth.users` row, one `user_profiles` role. A
 * manager or admin signs in here with the credentials their own phone uses.
 *
 * **The failure is reported, never guessed at.** Supabase answers "Invalid login credentials" for a
 * wrong password AND for an account that does not exist — deliberately, so the form cannot be used
 * to discover who has an account. The message is passed through rather than reworded into something
 * more specific than the server was willing to say.
 */
/**
 * The brand line, as the field app's sign-in shows it (`apps/field/app/sign-in.tsx`). Brand copy
 * rather than product copy, and it carries no trademark: the words are the same on both surfaces.
 */
const BRAND_LINE = 'Relief at the root.';

export default function SignIn(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Not annotated with React's own event type: React 19 deprecates those names, and the handler's
  // type is inferred from `onSubmit` below, which is the type that actually applies.
  const submit = (): void => {
    if (busy || email.trim() === '' || password === '') return;
    setBusy(true);
    setFailure(null);
    void browserClient()
      .auth.signInWithPassword({ email: email.trim(), password })
      .then(({ error }) => {
        if (error !== null) {
          setFailure(error.message);
          return;
        }
        // The cookie is written by the browser client; the server reads it on the next request.
        router.replace(params.get('next') ?? '/coaching');
        router.refresh();
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : 'Could not reach the sign-in service.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    // UX polish: the layout draws no sidebar before sign-in, and the error sits inside the card it
    // is about, as an alert. `FE-W122`: two panels -- the brand line on a quiet ground, the form on
    // its own card -- stacked one above the other on a tablet.
    <>
      <div className="ff-signin-brand">
        <span className="ff-brand-mark ff-brand-mark-lg">
          <Icon name="leaf" size={22} strokeWidth={2} />
        </span>
        {/* Not a heading, as in the field app: the first thing announced is the form's title. */}
        <p className="ff-brand-line">{BRAND_LINE}</p>
      </div>
      <div className="ff-signin-form">
        <div className="ff-signin-panel">
          <div className="ff-page-header-text">
            <Title>Sign in</Title>
            <Body muted>
              Use the account your organisation set up for you — the same one as the app.
            </Body>
          </div>
          <Card>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label className="ff-field">
                <span className="ff-label">Email</span>
                <input
                  aria-label="Email"
                  autoComplete="username"
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                  type="email"
                  value={email}
                />
              </label>
              <label className="ff-field">
                <span className="ff-label">Password</span>
                <input
                  aria-label="Password"
                  autoComplete="current-password"
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  type="password"
                  value={password}
                />
              </label>
              {failure === null ? null : <MissingNote tone="critical">{failure}</MissingNote>}
              <button className={btn('primary')} disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
