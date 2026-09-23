'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { Body, Card, MissingNote, Title } from '../../lib/ui';
import { browserClient } from '../../lib/supabase';

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
const field: CSSProperties = {
  width: '100%',
  padding: tokens.space.sm,
  borderRadius: tokens.radius.control,
  border: `1px solid ${tokens.color.border}`,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

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
    <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
      <Title>Sign in</Title>
      <Body muted>Use the account your organisation set up for you — the same one as the app.</Body>
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: compactTypography.label.size }}>Email</span>
            <input
              aria-label="Email"
              autoComplete="username"
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              style={field}
              type="email"
              value={email}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: compactTypography.label.size }}>Password</span>
            <input
              aria-label="Password"
              autoComplete="current-password"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              style={field}
              type="password"
              value={password}
            />
          </label>
          <button
            disabled={busy}
            style={{
              padding: tokens.space.sm,
              borderRadius: tokens.radius.control,
              border: 'none',
              background: tokens.color.accent,
              color: tokens.color.onAccent,
              fontSize: compactTypography.control.size,
              fontWeight: Number(compactTypography.control.weight),
              cursor: busy ? 'default' : 'pointer',
            }}
            type="submit"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </Card>
      {failure === null ? null : <MissingNote>{failure}</MissingNote>}
    </div>
  );
}
