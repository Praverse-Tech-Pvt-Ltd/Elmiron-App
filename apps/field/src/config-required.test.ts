import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '@fieldforce/core';
import { resolveApiTarget } from './api-target';

/**
 * `BE-W150` — what a production build still REQUIRES now that the retired mock-API gate is gone.
 *
 * `src/config.ts` builds the app's configuration with exactly this call at import, so a missing or
 * malformed value stops the app before anything mounts. These are the values the app talks to:
 * the Supabase URL and the publishable key. `EXPO_PUBLIC_API_BASE_URL` is not among them.
 */

const PRODUCTION = {
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  APP_JWT_AUDIENCE: 'authenticated',
  APP_SITE_URL: 'https://fieldforce.example.com',
  APP_ADDITIONAL_REDIRECT_URLS: '',
  APP_DEEP_LINK_SCHEME: 'com.praversetech.fieldforce',
};

describe('a production configuration', () => {
  it('loads with the Supabase URL and publishable key, and no API base URL at all', () => {
    const config = loadAppConfig(PRODUCTION);
    expect(config.supabaseUrl).toBe(PRODUCTION.SUPABASE_URL);
    expect(config.supabasePublishableKey).toBe(PRODUCTION.SUPABASE_PUBLISHABLE_KEY);
    expect(config.recordingEnabled).toBe(false);
  });

  it('still REFUSES a missing Supabase URL', () => {
    expect(() => loadAppConfig({ ...PRODUCTION, SUPABASE_URL: undefined })).toThrow(/supabaseUrl/u);
  });

  it('still REFUSES a Supabase URL that is not an address', () => {
    expect(() => loadAppConfig({ ...PRODUCTION, SUPABASE_URL: 'not a url' })).toThrow(
      /supabaseUrl/u,
    );
  });

  it('still REFUSES a missing publishable key', () => {
    expect(() => loadAppConfig({ ...PRODUCTION, SUPABASE_PUBLISHABLE_KEY: undefined })).toThrow(
      /supabasePublishableKey/u,
    );
    expect(() => loadAppConfig({ ...PRODUCTION, SUPABASE_PUBLISHABLE_KEY: '' })).toThrow(
      /supabasePublishableKey/u,
    );
  });
});

describe('development builds are unaffected', () => {
  it('the dev mock-API fallback still resolves as before', () => {
    expect(resolveApiTarget(undefined, { dev: true })).toEqual({
      kind: 'ok',
      baseUrl: 'http://127.0.0.1:4010',
    });
  });
});
