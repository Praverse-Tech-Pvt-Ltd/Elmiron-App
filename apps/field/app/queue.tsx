import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { QueueScreen } from '@fieldforce/ui';
import { loadQueueState } from '../src/sync/async-storage-store';
import { flushOutbox } from '../src/sync/outbox';
import { createPushClient } from '../src/sync/push-client';
import { presentRejection } from '../src/sync/explanation';
import { emptyQueue } from '../src/sync/reducer';
import type { SyncQueueState } from '../src/sync/reducer';

/**
 * Route binding. It reads state, passes it down, and renders. Nothing else.
 *
 * The screen lives in `packages/ui` because the console and a second app consume it
 * later, and a screen that lives in `apps/field` is a screen that gets rewritten.
 * This file exists only to bind one to the other.
 *
 * **This is also the compile-time check that the two shapes agree.** `packages/ui`
 * cannot import the reducer — a package must not depend on an app — so
 * `QueueScreenProps` is declared structurally. Passing a real `SyncQueueState`
 * straight through is what makes TypeScript verify the fit; if the reducer's state
 * ever diverges from what the screen accepts, this line stops compiling.
 *
 * The state now comes off disk. It used to be a hardcoded `emptyQueue`, because
 * nothing enqueued and there was no store; both are true no longer, and a screen
 * showing "everything is sent" while a check-in sat unsent would be the exact lie
 * that comment was written to avoid.
 *
 * "Try again now" is wired here rather than inside the screen: retrying is a
 * network operation and `packages/ui` has no client, which is the same boundary
 * that keeps the queue's verdicts server-owned.
 */
export default function Queue(): ReactNode {
  const [state, setState] = useState<SyncQueueState>(emptyQueue);
  const [retryFailed, setRetryFailed] = useState<string | null>(null);

  const refresh = (): void => {
    void loadQueueState().then(setState);
  };

  useEffect(refresh, []);

  return (
    <QueueScreen
      items={state.items}
      // `QueueScreen` renders its own `Screen`, so this route must not wrap it in a second
      // one -- that would nest two scroll views and double the page padding. The banner
      // therefore belongs to the screen, as a prop, which is also where it belongs
      // semantically: it is part of the queue's story, not a thing floating above it.
      {...(retryFailed === null ? {} : { retryFailure: retryFailed })}
      onRetry={() => {
        setRetryFailed(null);
        // **MR-28 C2.** This was `void flushOutbox(...).then(refresh)` with no `.catch`.
        //
        // `flushOutbox` handles each ITEM's verdict, but the flush itself can still
        // reject — the queue could not be read or written, or `createPushClient` threw
        // reaching the config. When it did, `refresh` never ran, the rows did not move,
        // and the MR had pressed "Try again now" on the screen that exists to tell them
        // why things are stuck. A silent tap there is worse than anywhere else in the
        // app, because this screen is where somebody goes when they already suspect
        // something is wrong.
        //
        // The FlushResult itself stays discarded, and that is correct: every verdict is
        // written to the queue, and `refresh` reads it back. The result is a summary of
        // what the rows already say.
        void flushOutbox(createPushClient())
          .then(refresh)
          .catch((error: unknown) => {
            setRetryFailed(
              error instanceof Error
                ? `${error.message} Nothing has been lost — everything below is still on this phone.`
                : 'Nothing has been lost — everything below is still on this phone.',
            );
          });
      }}
      /*
        MR-17 B1. Through `presentRejection`, which until now was written, tested and
        CALLED BY NOTHING -- the reducer's records went straight to the screen, so the
        remedy it derives and the retry/escalate judgement it makes were both unreachable.
        This is the line that makes the SQLSTATE mean something to an MR.
      */
      rejections={Object.fromEntries(
        Object.entries(state.rejections).map(([id, record]) => [id, presentRejection(record)]),
      )}
    />
  );
}
