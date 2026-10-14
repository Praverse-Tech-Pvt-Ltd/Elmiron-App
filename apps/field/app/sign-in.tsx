import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Banner,
  BodyText,
  BrandLine,
  Button,
  PasswordField,
  Screen,
  TextField,
  Title,
  useT,
} from '@fieldforce/ui';
import { useSession } from '../src/session';
import { signInFailure } from '../src/errors/sign-in';

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

/** `FE-W192`. A no-break space: one blank line of the note's own size, read as nothing. */
const RESERVED_LINE = '\u00A0';

export default function SignIn(): ReactNode {
  const { t } = useT();
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
        // `FE-W186`. The app's own sentence for each failure the auth server names ("That email
        // and password don't match."), never the server's English string ("Invalid login
        // credentials") — specific still, so a wrong password is not "something went wrong".
        setFailure(signInFailure(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const blocked = busy || email === '' || password === '';

  /*
    Phase 1 §05 pairs every disabled control with the reason it is disabled —
    without one the button greys out and says nothing, which reads as a broken
    app rather than as an unfinished form.

    FE-W102. Pinned in the footer, as every other screen's one primary is (§04): it sits in the
    thumb's reach and rides up with the keyboard, instead of under the fields at whatever height
    the form happens to end. The fields stay in the scrolling content above it.

    `FE-W192`. The reason line's place is kept once there is no reason left. It used to vanish the
    moment both fields were filled — `PrimaryButton` renders its note only while disabled — and
    the pinned button dropped by a line under the thumb reaching for it. A blank line of the same
    text role holds the place, so the button stays where the rep's thumb already is.
  */
  const label = busy ? t('signIn.submitting') : t('signIn.submit');
  const action = blocked ? (
    <Button
      disabled
      label={label}
      note={busy ? t('signIn.checking') : t('signIn.needDetails')}
      onPress={submit}
    />
  ) : (
    <Button label={label} note={RESERVED_LINE} onPress={submit} />
  );

  return (
    <Screen scrollable footer={action}>
      {/*
        §03's login splash, and the only place Cormorant appears in the product.
        Above the heading rather than instead of it: the brand line is not a screen
        title, and "Sign in" still has to be the first thing that tells the MR what
        this screen is for.
      */}
      <BrandLine>{BRAND_LINE}</BrandLine>
      {/* `FE-W178`. The screen's title is `Title`, as every other screen's is. */}
      <Title>{t('signIn.title')}</Title>
      <BodyText muted>{t('signIn.lead')}</BodyText>

      {failure === null ? null : (
        <Banner tone="critical" title={t('signIn.failed')} detail={failure} />
      )}

      <TextField
        label={t('signIn.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!busy}
      />
      {/* `FE-W192`. With "Show password", so a mistyped password is seen before it is sent. */}
      <PasswordField
        label={t('signIn.password')}
        value={password}
        onChangeText={setPassword}
        editable={!busy}
      />
    </Screen>
  );
}
