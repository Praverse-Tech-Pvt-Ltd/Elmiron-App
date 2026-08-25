import { useState } from 'react';
import type { ReactNode } from 'react';
import { QueueScreen } from '@fieldforce/ui';
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
 * The state is `emptyQueue` and never changes yet, deliberately. Nothing enqueues
 * until FE-W3 and there is no persistent store — PowerSync is a native module needing
 * a development build that does not exist. Wiring a fake source here would be a
 * screen that lies about the MR's day.
 */
export default function Queue(): ReactNode {
  const [state] = useState<SyncQueueState>(emptyQueue);
  return <QueueScreen items={state.items} rejections={state.rejections} />;
}
