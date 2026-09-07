import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Banner,
  BodyText,
  BrandLine,
  Heading,
  PrimaryButton,
  Screen,
  TextField,
} from '@fieldforce/ui';
import { useSession } from '../src/session';

/**
 * The brand line, §03's one Cormorant moment.
 *
 * Kept as a constant here rather than in `packages/ui` because it is brand copy:
 * `docs/brand-identifier-decision.md` keeps branding changeable without an
 * engineer, and O2 — closed for India in `docs/frontend-status.md` — puts the
 * display half of the identity deliberately on the free side of that line. The
 * words carry no trademark; the mark itself appears nowhere in this app.
 */
const BRAND_LINE = 'Relief at the root.';

export default function SignIn(): ReactNode {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (): void => {
    setBusy(true);
    setFailure(null);
    void signIn(email, password)
      .catch((error: unknown) => {
        // The server's wording, not ours. Inventing a friendlier message here is
        // how "invalid credentials" becomes "something went wrong" and a support
        // call becomes unanswerable.
        setFailure(error instanceof Error ? error.message : 'Sign-in failed.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const blocked = busy || email === '' || password === '';

  return (
    <Screen scrollable>
      {/*
        §03's login splash, and the only place Cormorant appears in the product.
        Above the heading rather than instead of it: the brand line is not a screen
        title, and "Sign in" still has to be the first thing that tells the MR what
        this screen is for.
      */}
      <BrandLine>{BRAND_LINE}</BrandLine>
      <Heading>Sign in</Heading>
      <BodyText muted>Use the account your manager set up for you.</BodyText>

      {failure === null ? null : (
        <Banner tone="critical" title="Could not sign in" detail={failure} />
      )}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!busy}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        editable={!busy}
      />
      {/*
        Phase 1 §05 pairs every disabled control with the reason it is disabled —
        without one the button greys out and says nothing, which reads as a broken
        app rather than as an unfinished form. `PrimaryButton` renders the note only
        while disabled, so it appears and disappears with the blocked state.
      */}
      <PrimaryButton
        label={busy ? 'Signing in…' : 'Sign in'}
        onPress={submit}
        disabled={blocked}
        note={busy ? 'Checking your details.' : 'Enter your email and password.'}
      />
    </Screen>
  );
}
