import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { createClientForScenario } from '../api';
import { flushOutbox } from './outbox';

/**
 * Tries the outbox whenever the app comes to the foreground.
 *
 * **This exists because the app makes a promise and something has to keep it.** A
 * queued check-in tells the MR "it will send by itself when you have signal". Until
 * this component, nothing sent anything by itself — the only path was a retry
 * button that appears only after three failed attempts, which an MR with restored
 * signal and one waiting item would never see.
 *
 * **At the root, once**, for the same reason `AuthGate` is: put it on a screen and
 * the next screen is broken by default. An MR who checks in offline and then walks
 * around the app must have their work sent from wherever they happen to be.
 *
 * **Foreground, not a timer.** There is no background execution here — that is the
 * same decision as location (`fe-w3-spec.md` §4a), and a repeating alarm is exactly
 * the kind of background work this app has said it does not do. Coming back to the
 * app is the signal, and it is the moment an MR is most likely to have signal
 * again.
 *
 * Failures are deliberately silent. A flush that cannot reach the server has
 * changed nothing — the work is still queued and the queue screen still says so —
 * and an error toast for something the MR did not ask for is noise about a
 * condition they already know they are in.
 */
export const OutboxFlusher = ({ children }: { readonly children: ReactNode }): ReactNode => {
  useEffect(() => {
    const attempt = (): void => {
      void flushOutbox(createClientForScenario()).catch(() => {
        // Nothing to report. The queue is unchanged and remains visible.
      });
    };

    // Once on mount — a cold start after a day offline is the case that matters
    // most, and it is the one where the MR has just regained signal.
    attempt();

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') attempt();
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return children;
};
