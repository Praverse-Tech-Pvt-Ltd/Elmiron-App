import { describe, expect, it } from 'vitest';
import type { SyncItemReinstatement, SyncQueueItem } from '@elmiron/core';
import type { ServerVerdict } from './events';
import { emptyQueue, summarise, syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';

const item = (id: string, clientCreatedAt: string): SyncQueueItem => ({
  id,
  entity: 'check_in',
  operation: 'create',
  entityId: `entity-${id}`,
  payload: {},
  status: 'queued',
  attemptCount: 0,
  lastError: null,
  clientCreatedAt,
  syncedAt: null,
});

const verdict = (over: Partial<ServerVerdict> & { id: string }): ServerVerdict => ({
  status: 'accepted',
  rejectionCode: null,
  explanation: null,
  warnings: [],
  attemptsRemaining: 2,
  receivedAt: '2026-08-14T10:00:00.000Z',
  ...over,
});

const reduceAll = (events: readonly Parameters<typeof syncQueueReducer>[1][]): SyncQueueState =>
  events.reduce(syncQueueReducer, emptyQueue);

const find = (state: SyncQueueState, id: string): SyncQueueItem | undefined =>
  state.items.find((i) => i.id === id);

describe('enqueue', () => {
  it('orders by the device clock, which is the order the work was done', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('b', '2026-08-14T09:30:00.000Z') },
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
    ]);
    expect(state.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('ignores a repeat of a known id rather than making a second row', () => {
    // The id is the server's idempotency key. Two local rows is two visits.
    const first = item('a', '2026-08-14T09:00:00.000Z');
    const state = reduceAll([
      { type: 'enqueued', item: first },
      { type: 'enqueued', item: { ...first, payload: { changed: true } } },
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.payload).toEqual({});
  });
});

describe('a verdict of accepted or duplicate', () => {
  it.each(['accepted', 'duplicate'] as const)('marks %s as synced', (status) => {
    // `duplicate` means an earlier attempt already landed. Showing that as a failure
    // puts a red row in front of an MR whose work is safe.
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'batch_started', ids: ['a'] },
      { type: 'verdict_received', verdict: verdict({ id: 'a', status }) },
    ]);
    expect(find(state, 'a')?.status).toBe('synced');
    expect(summarise(state).unsynced).toBe(0);
  });

  it('stamps syncedAt from the server clock, not the device', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      {
        type: 'verdict_received',
        verdict: verdict({ id: 'a', receivedAt: '2026-08-14T11:22:33.000Z' }),
      },
    ]);
    expect(find(state, 'a')?.syncedAt).toBe('2026-08-14T11:22:33.000Z');
  });

  it('keeps a warning on an accepted item rather than dropping it', () => {
    // stale_beat_plan is an accepted item the MR still needs to know about. The
    // manager revised the plan while they worked the old one; the work stands.
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      {
        type: 'verdict_received',
        verdict: verdict({ id: 'a', warnings: ['stale_beat_plan'] }),
      },
    ]);
    expect(find(state, 'a')?.status).toBe('synced');
    expect(state.warnings['a']).toEqual(['stale_beat_plan']);
  });
});

describe('a rejection', () => {
  it('records the code and the server sentence, and marks the item failed', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      {
        type: 'verdict_received',
        verdict: verdict({
          id: 'a',
          status: 'rejected',
          rejectionCode: 'outside_shift_window',
          explanation: 'This visit was recorded outside your territory working hours.',
        }),
      },
    ]);
    expect(find(state, 'a')?.status).toBe('failed');
    expect(state.rejections['a']?.code).toBe('outside_shift_window');
    expect(state.rejections['a']?.explanation).toBe(
      'This visit was recorded outside your territory working hours.',
    );
  });

  it('survives in the state — it is not a toast that can be missed', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      {
        type: 'verdict_received',
        verdict: verdict({ id: 'a', status: 'rejected', rejectionCode: 'outside_geofence' }),
      },
      { type: 'enqueued', item: item('b', '2026-08-14T10:00:00.000Z') },
      { type: 'batch_started', ids: ['b'] },
      { type: 'verdict_received', verdict: verdict({ id: 'b' }) },
    ]);
    expect(state.rejections['a']?.code).toBe('outside_geofence');
    expect(find(state, 'a')?.status).toBe('failed');
  });

  it('refuses a refusal with no code rather than showing an unexplained failure', () => {
    expect(() =>
      reduceAll([
        { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
        {
          type: 'verdict_received',
          verdict: verdict({ id: 'a', status: 'rejected', rejectionCode: null }),
        },
      ]),
    ).toThrow(/no rejectionCode/);
  });

  it('marks a dead letter as such, with no attempts remaining', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      {
        type: 'verdict_received',
        verdict: verdict({
          id: 'a',
          status: 'dead_lettered',
          rejectionCode: 'validation_failed',
          attemptsRemaining: 0,
        }),
      },
    ]);
    expect(state.rejections['a']?.deadLettered).toBe(true);
    expect(summarise(state).deadLettered).toBe(1);
  });
});

describe('a failed attempt', () => {
  it('returns the item to queued and counts the attempt', () => {
    // No verdict means the server decided nothing. The work is still the MR's to
    // deliver, so it must not be dropped and must not read as failed.
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'batch_started', ids: ['a'] },
      { type: 'attempt_failed', ids: ['a'], error: 'network unreachable' },
    ]);
    expect(find(state, 'a')?.status).toBe('queued');
    expect(find(state, 'a')?.attemptCount).toBe(1);
    expect(state.rejections['a']).toBeUndefined();
  });

  it('never loses an item across a whole offline day of failed pushes', () => {
    const events: Parameters<typeof syncQueueReducer>[1][] = [
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'enqueued', item: item('b', '2026-08-14T10:00:00.000Z') },
      { type: 'enqueued', item: item('c', '2026-08-14T11:00:00.000Z') },
    ];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      events.push(
        { type: 'batch_started', ids: ['a', 'b', 'c'] },
        { type: 'attempt_failed', ids: ['a', 'b', 'c'], error: 'offline' },
      );
    }
    const state = reduceAll(events);
    expect(state.items).toHaveLength(3);
    expect(state.items.every((i) => i.status === 'queued')).toBe(true);
    expect(summarise(state).unsynced).toBe(3);
  });

  it('does not touch an item that was never in flight', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'attempt_failed', ids: ['a'], error: 'offline' },
    ]);
    expect(find(state, 'a')?.attemptCount).toBe(0);
  });
});

describe('isolation between items', () => {
  it('one rejected item does not affect the others in the same batch', () => {
    // sync_push isolates each item; the client must not undo that by failing a batch.
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'enqueued', item: item('b', '2026-08-14T10:00:00.000Z') },
      { type: 'batch_started', ids: ['a', 'b'] },
      {
        type: 'verdict_received',
        verdict: verdict({ id: 'a', status: 'rejected', rejectionCode: 'not_your_record' }),
      },
      { type: 'verdict_received', verdict: verdict({ id: 'b' }) },
    ]);
    expect(find(state, 'a')?.status).toBe('failed');
    expect(find(state, 'b')?.status).toBe('synced');
  });

  it('ignores a verdict for an id this device is not holding', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'verdict_received', verdict: verdict({ id: 'unknown' }) },
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.rejections['unknown']).toBeUndefined();
  });
});

describe('reinstatement', () => {
  const reinstatement = (over: Partial<SyncItemReinstatement> = {}): SyncItemReinstatement => ({
    id: 'r1',
    syncItemId: 'a',
    reinstatedByUserId: 'manager-1',
    reason: 'Shift window was misconfigured for this territory.',
    attemptsAtReinstatement: 0,
    createdAt: '2026-08-14T12:00:00.000Z',
    receivedAt: '2026-08-14T12:00:01.000Z',
    ...over,
  });

  const deadLettered: Parameters<typeof syncQueueReducer>[1][] = [
    { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
    {
      type: 'verdict_received',
      verdict: verdict({
        id: 'a',
        status: 'dead_lettered',
        rejectionCode: 'outside_shift_window',
        attemptsRemaining: 0,
      }),
    },
  ];

  it('returns the item to the queue and records who did it and why', () => {
    const state = reduceAll([
      ...deadLettered,
      { type: 'reinstated', reinstatement: reinstatement() },
    ]);
    expect(find(state, 'a')?.status).toBe('queued');
    expect(state.reinstatements['a']?.reinstatedByUserId).toBe('manager-1');
    expect(state.reinstatements['a']?.reason).toMatch(/misconfigured/);
  });

  it('keeps the original rejection — a reversal does not erase what happened', () => {
    const state = reduceAll([
      ...deadLettered,
      { type: 'reinstated', reinstatement: reinstatement() },
    ]);
    expect(state.rejections['a']?.code).toBe('outside_shift_window');
    expect(state.rejections['a']?.deadLettered).toBe(true);
  });

  it.each(['', '   '])('refuses a reinstatement whose reason is %j', (reason) => {
    // Attribution plus a mandatory reason is the entire control here. There is no
    // fault taxonomy behind it, so an empty reason leaves nothing at all.
    expect(() =>
      reduceAll([
        ...deadLettered,
        { type: 'reinstated', reinstatement: reinstatement({ reason }) },
      ]),
    ).toThrow(/requires a reason/);
  });

  it('ignores a reinstatement for an item this device does not hold', () => {
    const state = reduceAll([
      { type: 'reinstated', reinstatement: reinstatement({ syncItemId: 'ghost' }) },
    ]);
    expect(state.items).toHaveLength(0);
    expect(state.reinstatements['ghost']).toBeUndefined();
  });
});

describe('summarise', () => {
  it('reports the oldest unsynced item under a name that says whose clock it is', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'enqueued', item: item('b', '2026-08-14T10:00:00.000Z') },
      { type: 'verdict_received', verdict: verdict({ id: 'a' }) },
    ]);
    const summary = summarise(state);
    expect(summary.total).toBe(2);
    expect(summary.unsynced).toBe(1);
    expect(summary.oldestUnsyncedClientCreatedAt).toBe('2026-08-14T10:00:00.000Z');
  });

  it('reports nothing outstanding when everything has landed', () => {
    const state = reduceAll([
      { type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') },
      { type: 'verdict_received', verdict: verdict({ id: 'a' }) },
    ]);
    expect(summarise(state).oldestUnsyncedClientCreatedAt).toBeNull();
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const before = reduceAll([{ type: 'enqueued', item: item('a', '2026-08-14T09:00:00.000Z') }]);
    const snapshot = JSON.stringify(before);
    syncQueueReducer(before, { type: 'batch_started', ids: ['a'] });
    syncQueueReducer(before, { type: 'verdict_received', verdict: verdict({ id: 'a' }) });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('is decidable without knowing where anything is stored', () => {
    // The whole reason this can be written before PowerSync exists. If this file
    // ever needs to import the store to decide a transition, the boundary is gone.
    const source = syncQueueReducer.toString();
    expect(source).not.toMatch(/store|persist|database|sqlite|powersync/iu);
  });
});
