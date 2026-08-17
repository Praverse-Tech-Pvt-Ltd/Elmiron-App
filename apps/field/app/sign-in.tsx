import { useState } from 'react';
import type { ReactNode } from 'react';
import { Banner, BodyText, Heading, PrimaryButton, Screen, TextField } from '@fieldforce/ui';
import { useSession } from '../src/session';

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

  return (
    <Screen scrollable>
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
      <PrimaryButton
        label={busy ? 'Signing in…' : 'Sign in'}
        onPress={submit}
        disabled={busy || email === '' || password === ''}
      />
    </Screen>
  );
}
