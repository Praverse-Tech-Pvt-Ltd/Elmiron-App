import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/session';
import { AuthGate } from '../src/auth-gate';
import { OutboxFlusher } from '../src/sync/flusher';

export default function RootLayout(): ReactNode {
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
