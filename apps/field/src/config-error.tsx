import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Banner, BodyText, Screen, Title, t, useLanguage } from '@fieldforce/ui';

/**
 * FE-D2 2 — what a release build with no real API address shows INSTEAD of the app.
 *
 * Two readers. The rep, who can do nothing about it and must not be left wondering whether their
 * work is being lost; and whoever made the build, who needs the exact variable. So the first
 * sentence is for the rep and the banner carries the build's own reason, verbatim.
 *
 * Nothing behind this mounts — no session, no pull, no outbox — so nothing is recorded or sent
 * while it is on screen, and it says so.
 *
 * `FE-W156`. The rep's sentences are in the catalogue; `reason` is the build's own, for whoever
 * made it, and stays exactly as the build wrote it.
 */
export const ConfigurationError = ({ reason }: { readonly reason: string }): ReactNode => {
  useLanguage();
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Screen scrollable>
        {/* `FE-W178`. The screen's title is `Title`, as every other screen's is. */}
        <Title>{t('onboarding.notSetUp')}</Title>
        <BodyText>{t('onboarding.notSetUpDetail')}</BodyText>
        <Banner detail={reason} title={t('onboarding.configError')} tone="critical" />
      </Screen>
    </SafeAreaProvider>
  );
};
