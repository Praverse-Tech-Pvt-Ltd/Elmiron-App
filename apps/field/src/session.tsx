import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { readAppClaims } from './claims';
import type { Role } from './claims';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readPersistedSession } from './persisted-session';
import { supabase } from './supabase';
import { setQueueOwner } from './sync/async-storage-store';

export interface SessionState {
  /** `loading` until the stored session has been read from disk. */
  readonly status: 'loading' | 'signed-in' | 'signed-out';
  readonly session: Session | null;
  readonly role: Role | null;
  readonly territoryId: string | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A persisted session is read from AsyncStorage asynchronously. Rendering the
    // signed-out shell first and swapping would flash the login screen at an MR who
    // is already signed in, on every cold start.
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        // **MR-52 B2 / `FE-W67`.** `null` here does not mean signed out. Offline, a refresh fails
        // with a network error, which the library treats as retryable: it KEEPS the session in
        // storage and still answers null because the access token has expired. Asking storage is
        // what separates "cannot reach the server" from "the server rejected this session" -- on a
        // rejection the library has already removed the entry, so this finds nothing.
        const restored = data.session ?? (await readPersistedSession(AsyncStorage));
        setSession(restored);
        setReady(true);
      })
      // **MR-28 C2, and the worst outcome on the sweep's list.** No `.catch` stood here.
      // `getSession` reads AsyncStorage, and if that read rejects -- corrupt store, a
      // keychain the OS will not open -- `setReady(true)` never runs and the app sits on
      // its splash FOREVER. Not a silent tap: a handset that will not start, with no
      // message and nothing to press.
      //
      // Treated as signed out, which is the safe direction. It is also the true one: a
      // session that cannot be read is a session this app does not have. The MR signs in
      // again, which works, rather than force-stopping an app that never finishes loading.
      .catch(() => {
        setSession(null);
        setReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  /**
   * MR-49 / `FE-W61`. The outbox belongs to whoever is signed in. A LAYOUT effect, because every
   * layout effect runs before any ordinary effect: the flusher, which reads the queue from an
   * ordinary effect, can never see the previous user as the owner after a sign-in.
   */
  const userId = session?.user.id ?? null;
  useLayoutEffect(() => {
    setQueueOwner(userId);
  }, [userId]);

  const value = useMemo<SessionState>(() => {
    const claims = session === null ? null : readAppClaims(session.access_token);
    return {
      status: !ready ? 'loading' : session === null ? 'signed-out' : 'signed-in',
      session,
      role: claims?.appRole ?? null,
      territoryId: claims?.appTerritoryId ?? null,
      signIn: async (email: string, password: string): Promise<void> => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error !== null) throw error;
      },
      signOut: async (): Promise<void> => {
        await supabase.auth.signOut();
      },
    };
  }, [ready, session]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = (): SessionState => {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession was called outside SessionProvider.');
  return value;
};
