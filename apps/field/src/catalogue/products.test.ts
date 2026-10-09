import { describe, expect, it } from 'vitest';
import { PRODUCTS_CACHE_KEY, loadProductChoices, productLabel, toggleProduct } from './products';
import type { KeyValueStore, ProductReader } from './products';

/** `BE-W175` — the phone's product list: fresh, cached for offline, or honestly absent. */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const memory = (
  initial: Record<string, string> = {},
): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => Promise.resolve(data[key] ?? null),
    setItem: (key, value) => {
      data[key] = value;
      return Promise.resolve();
    },
  };
};

const reader = (
  result: { data: unknown; error: { message: string } | null },
  asked: string[] = [],
): ProductReader => ({
  from: () => ({
    select: (columns) => {
      asked.push(columns);
      return { eq: () => ({ order: () => Promise.resolve(result) }) };
    },
  }),
});

describe('loadProductChoices', () => {
  it('reads the active catalogue, labels it, and keeps a copy for offline', async () => {
    const store = memory();
    const list = await loadProductChoices(
      reader({
        data: [
          { id: A, brand_name: 'Activex', generic_name: 'activamide' },
          { id: B, brand_name: 'Kitto', generic_name: null },
        ],
        error: null,
      }),
      store,
      () => new Date('2026-10-09T10:00:00Z'),
    );
    expect(list).toEqual({
      kind: 'fresh',
      products: [
        { id: A, label: 'Activex (activamide)' },
        { id: B, label: 'Kitto' },
      ],
    });
    expect(JSON.parse(store.data[PRODUCTS_CACHE_KEY] ?? '{}')).toMatchObject({
      savedAt: '2026-10-09T10:00:00.000Z',
    });
  });

  it('offline (the read fails): the copy from the last read, said to be a copy', async () => {
    const store = memory({
      [PRODUCTS_CACHE_KEY]: JSON.stringify({
        savedAt: '2026-10-08T09:00:00.000Z',
        products: [{ id: A, label: 'Activex' }],
      }),
    });
    const list = await loadProductChoices(
      reader({ data: null, error: { message: 'network' } }),
      store,
    );
    expect(list).toEqual({
      kind: 'cached',
      products: [{ id: A, label: 'Activex' }],
      savedAt: '2026-10-08T09:00:00.000Z',
    });
  });

  it('never read on this phone and offline: none -- not an empty catalogue', async () => {
    const list = await loadProductChoices(
      reader({ data: null, error: { message: 'network' } }),
      memory(),
    );
    expect(list).toEqual({ kind: 'none' });
  });

  it('a row that is not a product is not shown (the server shape is checked, not trusted)', async () => {
    const list = await loadProductChoices(
      reader({ data: [{ id: 'nope', brand_name: '' }], error: null }),
      memory(),
    );
    expect(list).toEqual({ kind: 'none' });
  });
});

describe('choosing products', () => {
  it('toggles in the order chosen', () => {
    expect(toggleProduct([], A)).toEqual([A]);
    expect(toggleProduct([A], B)).toEqual([A, B]);
    expect(toggleProduct([A, B], A)).toEqual([B]);
  });

  it('labels with the generic name only when there is one', () => {
    expect(productLabel('Activex', 'activamide')).toBe('Activex (activamide)');
    expect(productLabel('Kitto', null)).toBe('Kitto');
  });
});
