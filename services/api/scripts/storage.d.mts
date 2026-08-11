/** Types for the shared storage-deletion helper. */

export interface StorageConfig {
  apiUrl: string;
  bucket: string;
  serviceKey: string;
}

/**
 * True when a failed delete means the object is already absent.
 *
 * Exported separately from the request so the suite can pin the exact response
 * Supabase returns for a missing object — HTTP 400 with the 404 in the body — rather
 * than relying on a race to reproduce it.
 */
export declare const isAlreadyGone: (status: number, body: string) => boolean;

export declare const deleteStorageObject: (
  config: StorageConfig,
  storageKey: string,
) => Promise<void>;
