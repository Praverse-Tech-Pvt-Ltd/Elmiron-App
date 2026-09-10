import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond';
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
import { PulledStoreProvider } from '../src/sync/pulled-store';

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
  // §03's single Cormorant moment. One face, one weight, one screen — loaded here
  // because `useFonts` registers everything in one call, not because the brand
  // line is part of the working scale.
  CormorantGaramond_500Medium,
};

/**
 * How long the first paint will wait for the typeface before going without it.
 *
 * Long enough that a normal load is never seen as a flash of the wrong font,
 * short enough that a hang is a blink rather than a broken app.
 */
const FONT_DEADLINE_MS = 3_000;

export default function RootLayout(): ReactNode {
  const [fontsLoaded, fontError] = useFonts(FACES);

  /**
   * The first paint waits for the faces — but never indefinitely.
   *
   * Rendering first and letting the fonts swap in reflows every screen a beat
   * after it appears, and on sign-in that moves the field the MR is already
   * typing into. So the first paint waits.
   *
   * **It waits with a deadline, and that is not belt-and-braces.** `useFonts`
   * reports loaded or failed; it does not promise to do either. On the first run
   * of the dev build this hook did neither for as long as anyone watched, and the
   * app sat on a white screen with no error, no log and a live JS bundle — the
   * gate below was the whole cause. An app that renders nothing for ever because
   * a typeface did not arrive is worse in every way than one that renders in the
   * platform font, so after `FONT_DEADLINE_MS` it gives up waiting and paints.
   *
   * `fontError` is the same judgement for the case the hook does report: a missing
   * typeface is cosmetic, and this app is used in the field, so refusing to start
   * over one would turn a cosmetic failure into a total one.
   */
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setWaitedLongEnough(true);
    }, FONT_DEADLINE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!fontsLoaded && fontError === null && !waitedLongEnough) return null;

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
            {/*
              MR-14 B1. The pull's caller, at the root for the same reason the flusher is:
              every screen that reads the day reads it from here, and mounting it on one
              screen would leave the next one reading nothing. Inside AuthGate, so a
              signed-out session never pulls with no token.
            */}
            <PulledStoreProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }} />
            </PulledStoreProvider>
          </OutboxFlusher>
        </AuthGate>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
