import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import uuid from 'expo-modules-core/src/uuid';
import type { LiveTrackingStatus } from '@fieldforce/core';
import { liveTrackingEnabled } from '../features';
import { LiveRequestError } from '../live-rest';
import { useSession } from '../session';
import type { TrackingState } from '../integrations/tracking';
import { readOpenedDay, writeOpenedDay } from './day-store';
import { dayIsOpen, dueToSend, refreshAfter, stateOf, trackingLine } from './decide';
import type { LastSend, TrackingLine } from './decide';
import { appLiveTrackingBackend } from './backend';
import type { LiveTrackingBackend } from './live';

/**
 * `FE-W71` — the live tracker: one per app, mounted at the root, started and stopped by
 * `trackingState` and by nothing else.
 *
 * **Foreground only, by construction.** The watcher is `watchPositionAsync` — a foreground
 * subscription that needs only the permission check-in already asks for. It is started when the state
 * becomes `active` and removed the moment it is anything else, and `active` requires the app on
 * screen (`AppState`). Nothing here asks for, declares or prepares for background location: that is
 * blocked in the manifest (`plugins/android-release.cjs`) and pinned by
 * `src/onboarding/no-background-location.test.ts`, which this file must keep passing.
 *
 * **The server's picture is asked for again** when the app comes back on screen, every interval
 * while it is on screen, and after any refusal that means the picture is out of date — so the end of
 * working hours, the company switching off, or a new notice stops the watcher within one interval
 * even if no position is refused. And whatever the phone does, the server refuses to keep a position
 * outside those rules (`record_location_ping`).
 */
export type AcceptOutcome = 'accepted' | 'superseded' | 'failed';

export interface LiveTracker {
  readonly status: LiveTrackingStatus | null;
  readonly state: TrackingState;
  readonly line: TrackingLine;
  readonly dayOpen: boolean;
  readonly busy: boolean;
  readonly refresh: () => void;
  readonly accept: (noticeVersionId: string) => Promise<AcceptOutcome>;
  readonly withdraw: () => Promise<boolean>;
  /** The rep starts sharing for today. Asks for location, as the explicit request it is. */
  readonly openDay: () => Promise<void>;
  readonly closeDay: () => Promise<void>;
}

const TrackerContext = createContext<LiveTracker | null>(null);

/** Null when the build has live tracking off, or the signed-in user is not a rep. */
export const useLiveTracker = (): LiveTracker | null => useContext(TrackerContext);

export const LiveTrackingProvider = ({
  children,
  backend,
}: {
  readonly children: ReactNode;
  readonly backend?: LiveTrackingBackend;
}): ReactNode =>
  // Off in the build: not even the session is read. Nothing mounts, nothing is asked, nothing watches.
  liveTrackingEnabled ? <ForRep backend={backend}>{children}</ForRep> : children;

const ForRep = ({
  children,
  backend,
}: {
  readonly children: ReactNode;
  readonly backend: LiveTrackingBackend | undefined;
}): ReactNode => {
  const { session, role } = useSession();
  const userId = session?.user.id ?? null;
  // Only a rep shares a location; a manager or admin signed in on a phone gets nothing.
  if (role !== 'mr' || userId === null) return children;
  return (
    <Tracker backend={backend} userId={userId}>
      {children}
    </Tracker>
  );
};

const Tracker = ({
  children,
  backend: injected,
  userId,
}: {
  readonly children: ReactNode;
  readonly backend: LiveTrackingBackend | undefined;
  readonly userId: string;
}): ReactNode => {
  const backend = useMemo(() => injected ?? appLiveTrackingBackend(), [injected]);
  const [status, setStatus] = useState<LiveTrackingStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [openedDay, setOpenedDay] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastSend, setLastSend] = useState<LastSend | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSentAt = useRef<number | null>(null);

  const refresh = useCallback(() => {
    void backend.status().then(
      (next) => {
        setStatus(next);
        setLoadFailed(false);
      },
      () => {
        // A failed ask is "off", never a stale "on": the watcher stops until the server answers.
        setStatus(null);
        setLoadFailed(true);
      },
    );
  }, [backend]);

  useEffect(() => {
    void readOpenedDay(userId).then(setOpenedDay);
  }, [userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // Ask on mount and each time the app comes back on screen; then every interval while it is.
  const intervalSeconds = status?.intervalSeconds ?? 300;
  useEffect(() => {
    if (!foreground) return undefined;
    refresh();
    const timer = setInterval(refresh, intervalSeconds * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [foreground, intervalSeconds, refresh]);

  const state = stateOf(status, { foreground, openedDay });

  // The watcher, started by `active` and by nothing else.
  useEffect(() => {
    if (state !== 'active') return undefined;
    // An object, not a `let`: the cleanup may run while the subscription is still being made.
    const life: { removed: boolean; subscription: { remove: () => void } | null } = {
      removed: false,
      subscription: null,
    };
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (permission?.granted !== true) {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      const sub = await Location.watchPositionAsync(
        // Balanced, as check-in uses: precision nobody reads costs battery on a phone that must last.
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: intervalSeconds * 1000,
          distanceInterval: 0,
        },
        (fix) => {
          // Spacing measured between two of the phone's OWN fix times -- an elapsed duration, never
          // a decision about the time of day, which is the server's (`withinWorkingHours`).
          if (!dueToSend(lastSentAt.current, fix.timestamp, intervalSeconds)) return;
          lastSentAt.current = fix.timestamp;
          void backend
            .ping({
              id: uuid.v4(),
              latitude: fix.coords.latitude,
              longitude: fix.coords.longitude,
              accuracyM: fix.coords.accuracy,
              // The device's clock, labelled as such: the server bounds it and stamps its own.
              recordedAt: new Date(fix.timestamp).toISOString(),
            })
            .then(
              (verdict) => {
                setLastSend(
                  verdict.reason === null
                    ? { kind: 'kept' }
                    : { kind: 'refused', reason: verdict.reason },
                );
                if (refreshAfter(verdict)) refresh();
              },
              () => {
                // Dropped, not queued: see `live.ts` for why a live position is now or never.
                setLastSend({ kind: 'failed' });
              },
            );
        },
      ).catch(() => null);
      if (sub === null) {
        setLastSend({ kind: 'failed' });
        return;
      }
      if (life.removed) sub.remove();
      else life.subscription = sub;
    })();
    return () => {
      life.removed = true;
      life.subscription?.remove();
    };
  }, [state, intervalSeconds, backend, refresh]);

  const accept = useCallback(
    async (noticeVersionId: string): Promise<AcceptOutcome> => {
      setBusy(true);
      try {
        setStatus(await backend.accept(noticeVersionId));
        return 'accepted';
      } catch (error: unknown) {
        // `45001`: the notice changed between showing it and accepting it. Show the new one.
        if (error instanceof LiveRequestError && error.code === '45001') {
          refresh();
          return 'superseded';
        }
        return 'failed';
      } finally {
        setBusy(false);
      }
    },
    [backend, refresh],
  );

  const withdraw = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      setStatus(await backend.withdraw());
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [backend]);

  const openDay = useCallback(async (): Promise<void> => {
    if (status === null) return;
    // The rep pressed the button: this is the explicit request `shouldPromptForLocation` allows.
    const permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
    setPermissionDenied(permission?.granted !== true);
    await writeOpenedDay(userId, status.today).catch(() => undefined);
    setOpenedDay(status.today);
  }, [status, userId]);

  const closeDay = useCallback(async (): Promise<void> => {
    setOpenedDay(null);
    await writeOpenedDay(userId, null).catch(() => undefined);
  }, [userId]);

  const value = useMemo<LiveTracker>(
    () => ({
      status,
      state,
      line: trackingLine({ state, status, loadFailed, permissionDenied, lastSend }),
      dayOpen: dayIsOpen(status, openedDay),
      busy,
      refresh,
      accept,
      withdraw,
      openDay,
      closeDay,
    }),
    [
      status,
      state,
      loadFailed,
      permissionDenied,
      lastSend,
      openedDay,
      busy,
      refresh,
      accept,
      withdraw,
      openDay,
      closeDay,
    ],
  );

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
};
