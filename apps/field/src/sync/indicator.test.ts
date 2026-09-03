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
    expect(indicatorStateFor(state)).toEqual({ kind: 'waiting', count: 2 });
  });

  it('does not turn waiting red however many attempts it has taken', () => {
    const state = { ...emptyQueue, items: [item({ attemptCount: 9 })] };
    expect(indicatorStateFor(state).kind).toBe('waiting');
  });
});

describe('only a real failure is critical', () => {
  it('reports failed work as failed, with the attempts behind it', () => {
    const state = { ...emptyQueue, items: [item({ status: 'failed', attemptCount: 5 })] };
    expect(indicatorStateFor(state)).toEqual({ kind: 'failed', count: 1, attempts: 5 });
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
    expect(indicatorStateFor(state).kind).toBe('failed');
  });
});

describe('when nothing is outstanding', () => {
  it('is idle with no time at all on an empty queue', () => {
    // Not the device clock. The queue screen's rule — never show a device time as
    // though the server had confirmed something — applies to this line too.
    expect(indicatorStateFor(emptyQueue)).toEqual({ kind: 'idle', at: null });
  });

  it('shows the server’s own stamp once there is one', () => {
    const state = {
      ...emptyQueue,
      items: [item({ status: 'synced', syncedAt: '2026-09-02T12:09:00+05:30' })],
    };
    expect(indicatorStateFor(state)).toEqual({ kind: 'idle', at: '2026-09-02T12:09:00+05:30' });
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
    expect(indicatorStateFor(state)).toEqual({ kind: 'idle', at: '2026-09-02T12:09:00+05:30' });
  });
});
