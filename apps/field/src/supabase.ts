import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { appConfig } from './config';

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
    // There is no browser redirect on a device; the session arrives from the
    // password grant directly.
    detectSessionInUrl: false,
  },
});
