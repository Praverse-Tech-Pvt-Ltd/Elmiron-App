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

import { loadQueueState } from './async-storage-store';

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
