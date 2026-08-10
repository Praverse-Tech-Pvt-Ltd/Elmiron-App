import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './config.js';

const VALID = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  APP_JWT_AUDIENCE: 'authenticated',
  APP_SITE_URL: 'http://127.0.0.1:3000',
  APP_ADDITIONAL_REDIRECT_URLS: 'http://127.0.0.1:3000, https://127.0.0.1:3000',
  APP_DEEP_LINK_SCHEME: 'elmironmr',
};

describe('loadAppConfig', () => {
  it('loads every value from the environment', () => {
    const config = loadAppConfig(VALID);
    expect(config.jwtAudience).toBe('authenticated');
    expect(config.deepLinkScheme).toBe('elmironmr');
    expect(config.additionalRedirectUrls).toHaveLength(2);
  });

  it('treats an empty redirect list as valid — a mobile-only app has none', () => {
    expect(
      loadAppConfig({ ...VALID, APP_ADDITIONAL_REDIRECT_URLS: '' }).additionalRedirectUrls,
    ).toEqual([]);
  });

  it.each(['APP_JWT_AUDIENCE', 'APP_SITE_URL', 'APP_DEEP_LINK_SCHEME'])(
    'fails loudly when %s is missing rather than defaulting',
    (key) => {
      // A silently-wrong redirect URL is an auth loop nobody can debug from the
      // symptom, so absence must be an error and not a fallback.
      const env: Record<string, string | undefined> = { ...VALID, [key]: undefined };
      expect(() => loadAppConfig(env)).toThrow(/Invalid application configuration/);
    },
  );

  it('rejects a deep-link scheme that is not a scheme', () => {
    expect(() => loadAppConfig({ ...VALID, APP_DEEP_LINK_SCHEME: 'Elmiron MR://' })).toThrow();
  });
});
