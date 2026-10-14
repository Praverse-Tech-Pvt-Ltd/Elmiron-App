import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURE_FLAGS,
  expoGoEnv,
  parseExpoGoArgs,
  publishableKeyFrom,
} from '../scripts/expo-go.mjs';

/**
 * `FE-W206` — `pnpm expo-go`. The phone must be pointed at the LAPTOP: `apps/field/.env` says
 * `127.0.0.1`, which on a phone is the phone itself, and the app would sign in against nothing.
 */
describe('expoGoEnv', () => {
  const base = {
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_RECORDING_ENABLED: 'true',
    EXPO_PUBLIC_COACHING_ENABLED: 'true',
    EXPO_PUBLIC_APP_SITE_URL: 'https://kept.example',
  };
  const env = expoGoEnv({ ip: '192.168.1.7', publishableKey: 'sb_publishable_test', base });

  it("points the app at the laptop's Wi-Fi address, with the stack's key", () => {
    expect(env['EXPO_PUBLIC_SUPABASE_URL']).toBe('http://192.168.1.7:54321');
    expect(env['EXPO_PUBLIC_SUPABASE_KEY']).toBe('sb_publishable_test');
  });

  it('switches every built feature on, as the demo APK does', () => {
    for (const flag of ALL_FEATURE_FLAGS) expect(env[flag]).toBe('true');
  });

  it('keeps recording and coaching of real visits off whatever the shell says (D-15)', () => {
    expect(env['EXPO_PUBLIC_RECORDING_ENABLED']).toBeUndefined();
    expect(env['EXPO_PUBLIC_COACHING_ENABLED']).toBeUndefined();
  });

  it('fills the local app defaults only where the shell has none', () => {
    expect(env['EXPO_PUBLIC_APP_JWT_AUDIENCE']).toBe('authenticated');
    expect(env['EXPO_PUBLIC_APP_SITE_URL']).toBe('https://kept.example');
  });
});

describe('parseExpoGoArgs', () => {
  it('reads --ip and --no-seed', () => {
    expect(parseExpoGoArgs(['--no-seed', '--ip', '10.0.0.4'])).toEqual({
      ip: '10.0.0.4',
      seed: false,
      problems: [],
    });
  });

  it('refuses an address that is not IPv4, and an unknown argument', () => {
    expect(parseExpoGoArgs(['--ip', 'laptop']).problems).toHaveLength(1);
    expect(parseExpoGoArgs(['--fast']).problems).toEqual(['unknown argument: --fast']);
  });
});

describe('publishableKeyFrom', () => {
  it('reads the key from `supabase status -o env`, quoted or not', () => {
    expect(publishableKeyFrom('API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="sb_x"\n')).toBe(
      'sb_x',
    );
    expect(publishableKeyFrom('PUBLISHABLE_KEY=sb_y')).toBe('sb_y');
  });

  it('answers empty when the stack gave none', () => {
    expect(publishableKeyFrom('API_URL=http://127.0.0.1:54321')).toBe('');
  });
});
