import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from '@expo-google-fonts/dm-sans';
import { SessionProvider } from '../src/session';
import { AuthGate } from '../src/auth-gate';
import { OutboxFlusher } from '../src/sync/flusher';

/**
 * The four faces Phase 1's scale actually asks for.
 *
 * The keys are what `fontFamilyFor` returns, and they have to match exactly:
 * `useFonts` registers each face under the key it is given, so a mismatch
 * registers nothing and every screen silently falls back to the platform font —
 * which is the defect this whole change exists to fix, and it fails quietly.
 *
 * 100–300 are absent because §03 bans DM Sans below 400 anywhere, and 800/900
 * because nothing in the scale reaches them. Four faces rather than nine is
 * roughly 200KB less to ship and parse on a mid-range phone.
 */
const FACES = {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
};

export default function RootLayout(): ReactNode {
  const [fontsLoaded, fontError] = useFonts(FACES);

  /**
   * Nothing renders until the faces are registered — but a failure does not block
   * the app.
   *
   * Rendering first and letting the fonts swap in would reflow every screen a
   * beat after it appeared, and on the sign-in screen that means the field the MR
   * is already typing into moves under their thumb. So the first paint waits.
   *
   * `fontError` is the other half and it is not a crash: if a face cannot be read,
   * the app comes up in the platform's font rather than not at all. A missing
   * typeface is a cosmetic failure and this app is used in the field — refusing to
   * start over one would turn it into a total one.
   */
  if (!fontsLoaded && fontError === null) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AuthGate>
          {/*
            Inside AuthGate, so a signed-out session never pushes queued work with
            no token; and at the root, so an MR's offline check-ins go from whatever
            screen they happen to be on.
          */}
          <OutboxFlusher>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </OutboxFlusher>
        </AuthGate>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
