import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './config.js';

const VALID = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  APP_JWT_AUDIENCE: 'authenticated',
  APP_SITE_URL: 'http://127.0.0.1:3000',
  APP_ADDITIONAL_REDIRECT_URLS: 'http://127.0.0.1:3000, https://127.0.0.1:3000',
  APP_DEEP_LINK_SCHEME: 'com.praversetech.fieldforce',
};

describe('loadAppConfig', () => {
  it('loads every value from the environment', () => {
    const config = loadAppConfig(VALID);
    expect(config.jwtAudience).toBe('authenticated');
    expect(config.deepLinkScheme).toBe('com.praversetech.fieldforce');
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

/**
 * MR-53 B2 — the recording flag is enforced here, not documented somewhere.
 *
 * `C3` stands: scope §8.6 needs a named PV/DPDP signatory before the recording feature ships, and
 * §2.4's adverse-event duty follows from transcripts existing. The feature is built and
 * unreachable, and the half of that which lives in the client is this refusal.
 */
describe('MR-53 B2 — consultation recording cannot be enabled against a deployment', () => {
  const PRODUCTION = 'https://abcdefghijklmnopqrst.supabase.co';

  it('is OFF when nothing asks for it — the shipping state', () => {
    expect(loadAppConfig(VALID).recordingEnabled).toBe(false);
  });

  it('is off when the value is anything other than true', () => {
    for (const value of ['false', '1', 'yes', 'TRUE ', '']) {
      expect(
        loadAppConfig({ ...VALID, APP_RECORDING_ENABLED: value }).recordingEnabled,
        value,
      ).toBe(value === 'TRUE ');
    }
  });

  it('a production-shaped target REFUSES to start rather than quietly ignoring the flag', () => {
    expect(() =>
      loadAppConfig({ ...VALID, SUPABASE_URL: PRODUCTION, APP_RECORDING_ENABLED: 'true' }),
    ).toThrow(/may not be enabled against a deployment/u);
  });

  it('the refusal names the host it refused, so it cannot be mistaken for a DNS failure', () => {
    expect(() =>
      loadAppConfig({ ...VALID, SUPABASE_URL: PRODUCTION, APP_RECORDING_ENABLED: 'true' }),
    ).toThrow(/abcdefghijklmnopqrst\.supabase\.co/u);
  });

  it('a production target with the flag UNSET still loads — the guard is about the flag', () => {
    expect(loadAppConfig({ ...VALID, SUPABASE_URL: PRODUCTION }).recordingEnabled).toBe(false);
  });

  it('an unparseable URL is not treated as local', () => {
    expect(() =>
      loadAppConfig({ ...VALID, SUPABASE_URL: 'not a url', APP_RECORDING_ENABLED: 'true' }),
    ).toThrow();
  });

  it('POSITIVE CONTROL: a local stack may enable it', () => {
    expect(loadAppConfig({ ...VALID, APP_RECORDING_ENABLED: 'true' }).recordingEnabled).toBe(true);
    expect(
      loadAppConfig({
        ...VALID,
        SUPABASE_URL: 'http://localhost:54321',
        APP_RECORDING_ENABLED: 'true',
      }).recordingEnabled,
    ).toBe(true);
  });
});
