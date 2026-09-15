import { describe, expect, it } from 'vitest';
import { SyncQueueItemSchema } from '@fieldforce/core';
import type { SyncQueueItem } from '@fieldforce/core';
import { indicatorStateFor } from './indicator';
import { emptyQueue } from './reducer';

const item = (over: Partial<SyncQueueItem> = {}): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: '15151515-1515-4515-8515-151515151501',
    entity: 'check_in',
    operation: 'create',
    entityId: '66666666-6666-4666-8666-666666666601',
    payload: {},
    status: 'queued',
    attemptCount: 0,
    lastError: null,
    clientCreatedAt: '2026-09-02T11:56:00+05:30',
    syncedAt: null,
    ...over,
  });

describe('waiting is never red', () => {
  it('reports waiting work as waiting, whatever the count', () => {
    // §05, verbatim: "an MR offline all morning has done nothing wrong". A red badge
    // for the ordinary condition of the job teaches them to ignore red by lunchtime.
    const state = {
      ...emptyQueue,
      items: [item(), item({ id: '15151515-1515-4515-8515-151515151502' })],
    };
    expect(indicatorStateFor({ kind: 'loaded', state: state })).toEqual({
      kind: 'waiting',
      count: 2,
    });
  });

  it('does not turn waiting red however many attempts it has taken', () => {
    const state = { ...emptyQueue, items: [item({ attemptCount: 9 })] };
    expect(indicatorStateFor({ kind: 'loaded', state: state }).kind).toBe('waiting');
  });
});

describe('only a real failure is critical', () => {
  it('reports failed work as failed, with the attempts behind it', () => {
    const state = { ...emptyQueue, items: [item({ status: 'failed', attemptCount: 5 })] };
    expect(indicatorStateFor({ kind: 'loaded', state: state })).toEqual({
      kind: 'failed',
      count: 1,
      attempts: 5,
    });
  });

  it('prefers the failure over the waiting count when both exist', () => {
    // The failure is the thing that needs the MR. The waiting items will go by
    // themselves; the failed one will not.
    const state = {
      ...emptyQueue,
      items: [
        item(),
        item({ id: '15151515-1515-4515-8515-151515151502', status: 'failed', attemptCount: 3 }),
      ],
    };
    expect(indicatorStateFor({ kind: 'loaded', state: state }).kind).toBe('failed');
  });
});

describe('when nothing is outstanding', () => {
  it('is idle with no time at all on an empty queue', () => {
    // Not the device clock. The queue screen's rule — never show a device time as
    // though the server had confirmed something — applies to this line too.
    expect(indicatorStateFor({ kind: 'loaded', state: emptyQueue })).toEqual({
      kind: 'idle',
      at: null,
    });
  });

  it('shows the server’s own stamp once there is one', () => {
    const state = {
      ...emptyQueue,
      items: [item({ status: 'synced', syncedAt: '2026-09-02T12:09:00+05:30' })],
    };
    expect(indicatorStateFor({ kind: 'loaded', state: state })).toEqual({
      kind: 'idle',
      at: '12:09',
    });
  });

  it('takes the most recent stamp when several items synced', () => {
    const state = {
      ...emptyQueue,
      items: [
        item({ status: 'synced', syncedAt: '2026-09-02T09:00:00+05:30' }),
        item({
          id: '15151515-1515-4515-8515-151515151502',
          status: 'synced',
          syncedAt: '2026-09-02T12:09:00+05:30',
        }),
      ],
    };
    expect(indicatorStateFor({ kind: 'loaded', state: state })).toEqual({
      kind: 'idle',
      at: '12:09',
    });
  });
});

describe('the last-sent time is a clock, not a timestamp', () => {
  it('shows 12:09, never the contract ISO string', () => {
    // Found by looking at the home screen: this rendered
    // "Everything sent 2026-09-03T08:57:43.905Z" — milliseconds, Z suffix and all.
    // The indicator prints `at` verbatim, so formatting is the caller's job.
    const state = {
      ...emptyQueue,
      items: [item({ status: 'synced', syncedAt: '2026-09-02T12:09:00+05:30' })],
    };
    const result = indicatorStateFor({ kind: 'loaded', state: state });
    expect(result).toEqual({ kind: 'idle', at: '12:09' });
  });

  it('keeps the offset the server sent rather than the handset’s idea of it', () => {
    // The Z form is UTC. An MR in IST reading it off their own screen would have
    // been five and a half hours out; slicing characters keeps the server's offset.
    const state = {
      ...emptyQueue,
      items: [item({ status: 'synced', syncedAt: '2026-09-02T08:57:43.905Z' })],
    };
    expect(indicatorStateFor({ kind: 'loaded', state: state }).kind).toBe('idle');
    expect(JSON.stringify(indicatorStateFor({ kind: 'loaded', state: state }))).not.toMatch(
      /T|Z|\./u,
    );
  });
});

/**
 * `FE-W44` — an unreadable queue is not an empty one.
 *
 * The store returned `emptyQueue` on a parse failure or an AsyncStorage rejection, so the
 * indicator said **"Everything sent"** — a claim that the MR's writes reached the server,
 * made at the moment the app could not read what those writes were.
 */
describe('FE-W44 — the queue could not be read', () => {
  it('is never idle, because "Everything sent" would be a claim about the SERVER', () => {
    expect(indicatorStateFor({ kind: 'unreadable' })).toEqual({ kind: 'unreadable' });
  });

  it('THE POSITIVE CONTROL: a genuinely empty queue is still idle', () => {
    // Without this, the case above is satisfiable by never reporting idle at all, which
    // would put a red badge on the home screen of every MR who has nothing outstanding.
    expect(indicatorStateFor({ kind: 'loaded', state: emptyQueue })).toEqual({
      kind: 'idle',
      at: null,
    });
  });
});
