import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { appConfig } from './config';
import { SESSION_STORAGE_KEY } from './persisted-session';

/**
 * Sign-in runs against the **local** Supabase stack in FE-W1.
 *
 * Production has no seeded reference data and no territory shift windows, so
 * capture refuses there by design — pointing the app at it would produce a string
 * of refusals that look like bugs and are not.
 */
export const supabase = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    /**
     * MR-52 B2 / `FE-W67`. Named explicitly so `persisted-session.ts` can read the very entry this
     * client writes. The default key is derived from the project URL, which would make the app's
     * own storage key change with the environment — and a key nobody can name is a key nobody can
     * read back. **One-time cost:** a device holding a session under the old derived key signs in
     * once more.
     */
    storageKey: SESSION_STORAGE_KEY,
    // There is no browser redirect on a device; the session arrives from the
    // password grant directly.
    detectSessionInUrl: false,
  },
});
