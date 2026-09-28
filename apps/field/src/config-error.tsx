import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Banner, BodyText, Heading, Screen } from '@fieldforce/ui';

/**
 * FE-D2 2 — what a release build with no real API address shows INSTEAD of the app.
 *
 * Two readers. The rep, who can do nothing about it and must not be left wondering whether their
 * work is being lost; and whoever made the build, who needs the exact variable. So the first
 * sentence is for the rep and the banner carries the build's own reason, verbatim.
 *
 * Nothing behind this mounts — no session, no pull, no outbox — so nothing is recorded or sent
 * while it is on screen, and it says so.
 */
export const ConfigurationError = ({ reason }: { readonly reason: string }): ReactNode => (
  <SafeAreaProvider>
    <StatusBar style="dark" />
    <Screen scrollable>
      <Heading>This copy of the app is not set up</Heading>
      <BodyText>
        It was built without the address of the server, so it cannot sign you in or send anything.
        Nothing is being recorded. Tell whoever gave you this app; it needs to be built again.
      </BodyText>
      <Banner detail={reason} title="Configuration error" tone="critical" />
    </Screen>
  </SafeAreaProvider>
);
