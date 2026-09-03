import type { SyncQueueState as UiSyncQueueState } from '@fieldforce/ui';
import { summarise } from './reducer';
import type { SyncQueueState } from './reducer';

/**
 * The queue, as the one line B1 puts on every screen.
 *
 * **Two `SyncQueueState` types meet here and they are not the same thing.** The
 * app's is the reducer's full state — items, rejections, warnings. The UI's is what
 * the indicator draws. This function is the only place that maps between them, so
 * the component keeps knowing nothing about the reducer and the reducer keeps
 * knowing nothing about how it is shown.
 *
 * **`failed` is the only state that becomes `critical`.** §05: "waiting is never
 * red — an MR offline all morning has done nothing wrong." Waiting, whatever the
 * count and however long, is the ordinary condition of the job.
 */
export const indicatorStateFor = (state: SyncQueueState): UiSyncQueueState => {
  const summary = summarise(state);

  if (summary.failed > 0) {
    // Attempts were made and the server did not take it. The one genuinely bad case.
    const attempts = Math.max(
      ...state.items.filter((item) => item.status === 'failed').map((item) => item.attemptCount),
      1,
    );
    return { kind: 'failed', count: summary.failed, attempts };
  }

  if (summary.unsynced > 0) {
    return { kind: 'waiting', count: summary.unsynced };
  }

  // Nothing outstanding. `at` stays null unless the server has actually stamped a
  // time — the queue screen's rule about never showing a device clock as though the
  // server had confirmed something applies to this line too.
  const lastSynced = state.items
    .map((item) => item.syncedAt)
    .filter((at): at is string => at !== null)
    .sort();

  return { kind: 'idle', at: lastSynced[lastSynced.length - 1] ?? null };
};
