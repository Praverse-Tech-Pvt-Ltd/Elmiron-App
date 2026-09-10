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
import type { Refusal } from '@fieldforce/core';
import { applyChanges, emptyStore, pullOnce, removalWording } from './pull';
import type { LocalStore, PullNotice, PullOutcome } from './pull';
import { asyncStoragePullCursorStore } from './pull-cursor';
import type { PullCursorStore } from './pull-cursor';
import { asyncStoragePulledStore, loadPulledStore } from './pulled-store-persistence';
import type { PulledStorePersistence } from './pulled-store-persistence';
import { useSession } from '../session';

/**
 * The caller `sync/pull.ts` never had — MR-14 B1, closing FE-W36.
 *
 * `pullOnce`, `applyChanges`, `doctorWithAddresses`, `noticeFor` and `removalWording` have
 * been complete and fully tested for several sessions, and **nothing in the app called any
 * of them**. That is the characteristic defect of this codebase stated exactly: a module
 * that passes review, passes its tests, and does nothing. This is the wire.
 *
 * **At the root, once**, for the reason `OutboxFlusher` is: put it on a screen and the next
 * screen is broken by default. Every screen that reads the day reads it from here.
 *
 * **Foreground, not a timer.** The same decision as the flusher and as location
 * (`fe-w3-spec.md` §4a): there is no background execution in this app, and a repeating
 * alarm is exactly the kind of background work it has said it does not do. Returning to the
 * app is the signal, and it is the moment an MR is most likely to have signal again.
 *
 * **Failures are visible here, unlike the flusher's.** A flush that fails has changed
 * nothing and the queue still says so. A pull that fails means the screens are showing an
 * older day than the server has, and an MR cannot tell that by looking. So a refusal is
 * carried to the screen rather than swallowed.
 */

/** A record that has left the MR's scope, in the words they should read — B8. */
export interface RemovalNotice {
  readonly entity: 'visit' | 'doctor' | 'beat_plan' | 'clinic_address';
  readonly id: string;
  readonly reason: 'deleted' | 'out_of_scope';
  /**
   * `removalWording(reason)`. **Never "deleted" for a reassignment** — ADR §6 Q2. It is
   * false, and for a consent record dangerously so.
   */
  readonly message: string;
}

/**
 * Why the last sync did not land — and the two reasons are NOT the same thing.
 *
 * `refused` means the server answered and said no: there is a SQLSTATE, a mapped code and
 * a remedy. `unreachable` means nothing answered at all — no signal, a dead stack, a
 * response this build could not parse.
 *
 * **Collapsing them tells an MR they lack permission when their wifi dropped**, which is
 * the failure `doctors-route.test.tsx` has guarded since FE-W1 under the heading "separates
 * a transport failure from a denial". The first draft of this provider collapsed them and
 * that suite caught it, which is exactly what it is for.
 */
export type PullFailure =
  { readonly kind: 'refused'; readonly refusal: Refusal } | { readonly kind: 'unreachable' };

export interface PulledStoreState {
  readonly store: LocalStore;
  /** `loading` until the first pull settles, so a screen can tell empty from not-yet. */
  readonly status: 'loading' | 'ready' | 'failed';
  /** The completeness notice, or null when the server omitted nothing — B6. */
  readonly notice: PullNotice | null;
  /** Why the last sync did not land, or null when it did. */
  readonly failure: PullFailure | null;
  /** True when a too-old or unrecognised cursor forced a full re-sync — B7. */
  readonly resynced: boolean;
  /** What left the MR's scope on the last pull — B8. */
  readonly removals: readonly RemovalNotice[];
  readonly refresh: () => void;
}

const PulledStoreContext = createContext<PulledStoreState | null>(null);

export interface PulledStoreProviderProps {
  readonly children: ReactNode;
  /** Injected in tests. Production uses AsyncStorage for both. */
  readonly cursors?: PullCursorStore;
  readonly persistence?: PulledStorePersistence;
  /** Injected in tests, so a pull can be driven without a client or a network. */
  readonly pull?: typeof pullOnce;
}

/**
 * How many pages one sync will walk before stopping.
 *
 * `hasMore` is the server's, and a bounded loop rather than `while (hasMore)` is deliberate:
 * a server that always answered `true` would otherwise spin forever on a handset, draining
 * the battery of someone who cannot see why. Stopping early is safe — the next foreground
 * continues from the saved cursor — while spinning is not.
 */
const MAX_PAGES = 50;

export const PulledStoreProvider = ({
  children,
  cursors = asyncStoragePullCursorStore,
  persistence = asyncStoragePulledStore,
  pull = pullOnce,
}: PulledStoreProviderProps): ReactNode => {
  const { session, status: sessionStatus } = useSession();
  const userId = session?.user.id ?? null;

  const [store, setStore] = useState<LocalStore>(emptyStore);
  const [status, setStatus] = useState<PulledStoreState['status']>('loading');
  const [notice, setNotice] = useState<PullNotice | null>(null);
  const [failure, setFailure] = useState<PullFailure | null>(null);
  const [resynced, setResynced] = useState(false);
  const [removals, setRemovals] = useState<readonly RemovalNotice[]>([]);
  const [nonce, setNonce] = useState(0);

  // One sync at a time. A foreground event arriving mid-sweep would otherwise start a
  // second walk from the same cursor and apply every page twice -- harmless for an upsert,
  // and wasted work on a metered connection an MR is paying for.
  const running = useRef(false);

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (sessionStatus !== 'signed-in' || userId === null) {
      // Signed out: hold nothing. A shared handset that kept the previous MR's day on
      // screen would show one person another person's work.
      setStore(emptyStore());
      setStatus(sessionStatus === 'loading' ? 'loading' : 'ready');
      setNotice(null);
      setFailure(null);
      setRemovals([]);
      return;
    }

    let cancelled = false;

    const sync = async (): Promise<void> => {
      if (running.current) return;
      running.current = true;
      try {
        // P1. The records and the cursor move together: when the records cannot be
        // restored, `loadPulledStore` clears the cursor so this is a full sweep rather
        // than a delta onto nothing.
        let next = await loadPulledStore(userId, persistence, cursors);
        if (!cancelled) setStore(next);

        let pages = 0;
        let outcome: PullOutcome;
        do {
          outcome = await pull({ userId, cursors });
          if (cancelled) return;

          if (outcome.kind === 'refused') {
            // The server answered and said no. That is a verdict the MR must see: their
            // screens are older than the server and nothing about looking at them says so.
            setFailure({ kind: 'refused', refusal: outcome.refusal });
            setStatus('failed');
            return;
          }

          next = applyChanges(next, outcome.changes);
          setStore(next);
          setNotice(outcome.notice);
          setResynced(outcome.resynced);
          setRemovals(
            outcome.changes
              .filter((change) => change.kind === 'remove')
              .map((change) => ({
                entity: change.entity,
                id: change.id,
                reason: change.reason,
                message: removalWording(change.reason),
              })),
          );
          // Written after every page rather than at the end, so a sweep interrupted by
          // the app being killed leaves the records and the cursor agreeing with each
          // other rather than a cursor ahead of the records it was saved beside.
          await persistence.save(userId, next);
          pages += 1;
        } while (outcome.hasMore && pages < MAX_PAGES);

        setFailure(null);
        setStatus('ready');
      } catch (error: unknown) {
        if (cancelled) return;
        // A parse failure or an unreachable server. Both mean the screens are stale and
        // neither is something the MR can act on beyond trying again, so the status says
        // so and the store keeps whatever it had.
        // Nothing answered, or the answer did not parse. NOT a refusal: the server has
        // said nothing to report, and claiming it refused would invent a decision.
        setFailure({ kind: 'unreachable' });
        setStatus('failed');
        if (error instanceof Error && __DEV__) console.warn('sync_pull failed:', error.message);
      } finally {
        running.current = false;
      }
    };

    void sync();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [userId, sessionStatus, nonce, cursors, persistence, pull]);

  const value = useMemo<PulledStoreState>(
    () => ({ store, status, notice, failure, resynced, removals, refresh }),
    [store, status, notice, failure, resynced, removals, refresh],
  );

  return <PulledStoreContext.Provider value={value}>{children}</PulledStoreContext.Provider>;
};

export const usePulledStore = (): PulledStoreState => {
  const value = useContext(PulledStoreContext);
  if (value === null) throw new Error('usePulledStore was called outside PulledStoreProvider.');
  return value;
};
