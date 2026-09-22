import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItem = vi.fn<(key: string) => Promise<string | null>>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => getItem(key),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
    multiRemove: () => Promise.resolve(),
  },
}));

import { QUEUE_KEYS, loadQueueState, setQueueOwner } from './async-storage-store';

/**
 * `FE-W44` — where the defect actually lived.
 *
 * Every consumer was correct given what this returned. It returned `emptyQueue` for three
 * different facts — nothing queued, malformed JSON, and storage throwing — and only the
 * first of those is "nothing outstanding". The other two are "this app cannot tell you".
 */
describe('FE-W44 — loadQueueState distinguishes empty from unreadable', () => {
  beforeEach(() => {
    getItem.mockReset();
    // MR-49 / FE-W61. The queue belongs to a signed-in user; these cases are about one of them.
    setQueueOwner('rep-a');
  });

  it('nothing stored is LOADED and empty — that is an answer', () => {
    getItem.mockResolvedValue(null);
    return expect(loadQueueState()).resolves.toEqual({
      kind: 'loaded',
      state: { items: [], rejections: {}, reinstatements: {}, warnings: {} },
    });
  });

  it('malformed JSON is UNREADABLE, not empty', async () => {
    getItem.mockResolvedValue('{not json');
    await expect(loadQueueState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('a value that parses but is not an object is UNREADABLE', async () => {
    // `JSON.parse('7')` succeeds. Before MR-33 this returned emptyQueue.
    getItem.mockResolvedValue('7');
    await expect(loadQueueState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('storage itself rejecting is UNREADABLE', async () => {
    getItem.mockRejectedValue(new Error('SQLite disk image is malformed'));
    await expect(loadQueueState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('THE POSITIVE CONTROL: a real stored queue still loads its items', async () => {
    // Without this, returning `unreadable` unconditionally would satisfy every case above
    // and stop the app reading any queue at all.
    getItem.mockResolvedValue(
      JSON.stringify({ items: [], rejections: {}, reinstatements: {}, warnings: { a: ['x'] } }),
    );
    const load = await loadQueueState();
    expect(load.kind).toBe('loaded');
    expect(load.kind === 'loaded' ? load.state.warnings : null).toEqual({ a: ['x'] });
  });
});

/**
 * MR-49 / `FE-W61`. Measured on the Pixel 10 before this: rep A queued a check-in and a consent
 * answer offline and signed out; rep B's queue screen listed them and B's app sent them under B's
 * sign-in. The queue is now one key per user, and the old shared key is never read.
 */
describe('FE-W61 — the queue belongs to the MR who made it', () => {
  const ITEM_A = {
    id: '77777777-7777-4777-8777-777777777701',
    entity: 'check_in',
    operation: 'create',
    entityId: '66666666-6666-4666-8666-666666666601',
    payload: { visitId: '66666666-6666-4666-8666-666666666601' },
    status: 'queued',
    attemptCount: 0,
    lastError: null,
    clientCreatedAt: '2026-09-21T06:00:00.000Z',
    syncedAt: null,
  };
  const storedFor = (key: string): Promise<string | null> =>
    Promise.resolve(
      key === QUEUE_KEYS.forUser('rep-a')
        ? JSON.stringify({ items: [ITEM_A], rejections: {}, reinstatements: {}, warnings: {} })
        : null,
    );

  beforeEach(() => {
    getItem.mockReset();
    getItem.mockImplementation(storedFor);
  });

  it('POSITIVE CONTROL: rep A reads rep A’s queue', async () => {
    setQueueOwner('rep-a');
    const load = await loadQueueState();
    expect(load.kind === 'loaded' ? load.state.items.map((i) => i.id) : null).toEqual([ITEM_A.id]);
  });

  it('rep B does NOT see rep A’s queue on the same phone', async () => {
    setQueueOwner('rep-b');
    const load = await loadQueueState();
    expect(load.kind === 'loaded' ? load.state.items : null).toEqual([]);
  });

  it('never reads the old shared key, whoever is signed in', async () => {
    setQueueOwner('rep-b');
    await loadQueueState();
    expect(getItem.mock.calls.map(([key]) => key)).not.toContain(QUEUE_KEYS.legacyShared);
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([QUEUE_KEYS.forUser('rep-b')]);
  });

  it('with no one signed in there is no queue: UNREADABLE, so no writer files work under nobody', async () => {
    setQueueOwner(null);
    await expect(loadQueueState()).resolves.toEqual({ kind: 'unreadable' });
    expect(getItem).not.toHaveBeenCalled();
  });
});
