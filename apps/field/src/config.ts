import { loadAppConfig } from '@fieldforce/core';
import type { AppConfig } from '@fieldforce/core';

/**
 * The first caller of `loadAppConfig` in this repository.
 *
 * It throws on a missing or malformed value rather than defaulting, which is the
 * behaviour we want: a silently-wrong redirect URL is an auth loop nobody can debug
 * from the symptom. That means a missing `.env` value fails the app at import time,
 * loudly, on the first screen.
 *
 * Every value is read through `process.env.EXPO_PUBLIC_*` with **dot access**, on
 * purpose. Expo inlines these at build time by rewriting that exact syntax; bracket
 * access is not rewritten and yields `undefined` in a release bundle while working
 * fine in development. That is why this app does not set
 * `noPropertyAccessFromIndexSignature`.
 *
 * `EXPO_PUBLIC_*` is inlined into the shipped bundle and is readable by anyone with
 * the APK. Only the publishable key belongs here. The secret key would hand every
 * installed copy a credential that bypasses row-level security, which is the whole
 * enforcement boundary.
 */
export const appConfig: AppConfig = loadAppConfig({
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  APP_JWT_AUDIENCE: process.env.EXPO_PUBLIC_APP_JWT_AUDIENCE,
  APP_SITE_URL: process.env.EXPO_PUBLIC_APP_SITE_URL,
  APP_ADDITIONAL_REDIRECT_URLS: process.env.EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS,
  APP_DEEP_LINK_SCHEME: process.env.EXPO_PUBLIC_APP_DEEP_LINK_SCHEME,
});

/**
 * Where the API lives. FE-W1 through FE-W5 point at `services/mock`.
 *
 * On a physical device `localhost` is the phone, not the laptop, so this has to be
 * the machine's LAN address. It is configuration rather than a constant for exactly
 * that reason.
 */
export const apiBaseUrl: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4010';
