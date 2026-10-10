import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveClient } from '../capture/client';

/**
 * `BE-W175` — the products a rep may name on a call report: their company's ACTIVE catalogue.
 *
 * Read straight from `products` -- RLS already limits a rep to their own company's rows
 * (`products_select_own_organisation`) -- and kept on the phone, so a report written in a clinic
 * with no signal can still name what was discussed. The server re-checks every id it receives
 * (`call_reports_validate_products`); this list is a convenience, never the authority.
 *
 * Three answers, and the screen says which: `fresh` (just read), `cached` (from an earlier read --
 * offline, or the read failed), `none` (never read on this phone; the report can still go, with
 * no products, which the server accepts).
 */

export interface ProductChoice {
  readonly id: string;
  readonly label: string;
}

export type ProductList =
  | { readonly kind: 'fresh'; readonly products: readonly ProductChoice[] }
  | {
      readonly kind: 'cached';
      readonly products: readonly ProductChoice[];
      readonly savedAt: string;
    }
  | { readonly kind: 'none' };

/** The one read this needs, narrow enough to fake in a test. */
export interface ProductReader {
  from(table: 'products'): {
    select(columns: string): {
      eq(
        column: 'is_active',
        value: true,
      ): {
        order(
          column: 'brand_name',
        ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const PRODUCTS_CACHE_KEY = 'fieldforce.products.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The server's rows, checked rather than trusted. Throws on anything that is not a product row. */
const parseRows = (data: unknown): ProductChoice[] => {
  if (!Array.isArray(data)) throw new Error('products: not a list');
  return data.map((row: unknown) => {
    if (!isRecord(row)) throw new Error('products: not a row');
    const { id, brand_name: brand, generic_name: generic } = row;
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('products: bad id');
    if (typeof brand !== 'string' || brand.trim() === '')
      throw new Error('products: no brand name');
    if (generic !== null && generic !== undefined && typeof generic !== 'string') {
      throw new Error('products: bad generic name');
    }
    return { id, label: productLabel(brand, typeof generic === 'string' ? generic : null) };
  });
};

/** The phone's saved copy, checked the same way. */
const parseCache = (raw: string): { savedAt: string; products: ProductChoice[] } => {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    typeof parsed['savedAt'] !== 'string' ||
    !Array.isArray(parsed['products'])
  ) {
    throw new Error('products cache: unreadable');
  }
  const products = parsed['products'].map((p: unknown) => {
    if (
      !isRecord(p) ||
      typeof p['id'] !== 'string' ||
      !UUID.test(p['id']) ||
      typeof p['label'] !== 'string'
    ) {
      throw new Error('products cache: bad entry');
    }
    return { id: p['id'], label: p['label'] };
  });
  return { savedAt: parsed['savedAt'], products };
};

/** "Brand (generic)", or the brand alone when there is no generic name. */
export const productLabel = (brand: string, generic: string | null): string =>
  generic === null || generic.trim() === '' ? brand : `${brand} (${generic})`;

const fromCache = async (store: KeyValueStore): Promise<ProductList> => {
  try {
    const raw = await store.getItem(PRODUCTS_CACHE_KEY);
    if (raw === null) return { kind: 'none' };
    const parsed = parseCache(raw);
    return { kind: 'cached', products: parsed.products, savedAt: parsed.savedAt };
  } catch {
    return { kind: 'none' };
  }
};

export const loadProductChoices = async (
  reader?: ProductReader,
  store?: KeyValueStore,
  // A RECORD of when this phone saved its copy (shown as "saved earlier"), not a decision about
  // the day -- the handset is the only possible source.
  // eslint-disable-next-line no-restricted-syntax
  now: () => Date = () => new Date(),
): Promise<ProductList> => {
  const kv: KeyValueStore = store ?? AsyncStorage;
  try {
    const db = await resolveClient<ProductReader>(reader);
    const { data, error } = await db
      .from('products')
      .select('id, brand_name, generic_name')
      .eq('is_active', true)
      .order('brand_name');
    if (error !== null) return await fromCache(kv);
    const products = parseRows(data);
    try {
      await kv.setItem(
        PRODUCTS_CACHE_KEY,
        JSON.stringify({ savedAt: now().toISOString(), products }),
      );
    } catch {
      // The list is still right for this screen; only the offline copy is missing.
    }
    return { kind: 'fresh', products };
  } catch {
    return fromCache(kv);
  }
};

/** Toggle one product in the chosen list, keeping the order in which they were chosen. */
export const toggleProduct = (chosen: readonly string[], id: string): readonly string[] =>
  chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
