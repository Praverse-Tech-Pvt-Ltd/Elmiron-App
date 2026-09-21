import type { SyncQueueState as UiSyncQueueState } from '@fieldforce/ui';
import type { QueueLoad } from './async-storage-store';
import { clockFrom } from '../today/plan';
import { summarise } from './reducer';

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
export const indicatorStateFor = (load: QueueLoad): UiSyncQueueState => {
  // `FE-W44`. Taking the LOAD rather than the state is the fix: a caller cannot reach the
  // queue without first saying what it will do when there isn't one.
  if (load.kind === 'unreadable') return { kind: 'unreadable' };
  const state = load.state;
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

  const latest = lastSynced[lastSynced.length - 1];

  // **Formatted, not raw.** The indicator renders `at` verbatim, and this used to
  // hand it a contract ISO timestamp — "Everything sent 2026-09-03T08:57:43.905Z"
  // sat on the MR's home screen, milliseconds, Z suffix and all. Worse than ugly:
  // the Z is UTC, so an MR in IST was being shown a time five and a half hours off
  // the one they would have read off the clock. `clockFrom` slices the characters
  // rather than parsing, which keeps the offset the server sent.
  return { kind: 'idle', at: latest === undefined ? null : clockFrom(latest) };
};

/**
 * MR-49 / `FE-W61`. What the Me screen says above "Sign out" when this MR still has work on the
 * phone, or `null` when there is none.
 *
 * Unsent is `queued`, `in_flight` or `failed` -- everything the server has not taken. The claim is
 * exactly what the per-user queue now guarantees: it stays under this MR's account, it goes the
 * next time THEY sign in here, and nobody else who signs in on this phone sees or sends it.
 */
export const unsentBeforeSignOut = (
  items: readonly { readonly status: string }[],
): { title: string; detail: string } | null => {
  const count = items.filter(
    (item) => item.status === 'queued' || item.status === 'in_flight' || item.status === 'failed',
  ).length;
  if (count === 0) return null;
  return {
    title:
      count === 1
        ? '1 thing has not been sent yet'
        : `${String(count)} things have not been sent yet`,
    detail:
      'They stay on this phone under your account and send the next time you sign in here. Nobody else who signs in on this phone will see or send them.',
  };
};
