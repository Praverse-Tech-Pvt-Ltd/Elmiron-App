import { appConfig } from './config';
import { supabase } from './supabase';
import type { LiveConnection } from './live-rest';

/**
 * W2-C C / `BE-W160` — the connection a live AI transport uses on the device: the project URL and
 * publishable key from the build's config (they identify the PROJECT, never the user), and the
 * signed-in rep's own access token, read at the moment of the call so a refreshed token is used.
 * With nobody signed in it is null, and `live-rest` sends nothing.
 */
export const appLiveConnection = (): LiveConnection => ({
  baseUrl: appConfig.supabaseUrl,
  apiKey: appConfig.supabasePublishableKey,
  accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
