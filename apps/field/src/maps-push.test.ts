import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../plugins/maps-push.cjs';

/**
 * `FE-W85` / `FE-W86` — the build wiring for the two key-gated integrations. The key below is made
 * up; no real key or Firebase file is in this repository.
 */
const { withMapsAndPush } = plugin;

const BASE = {
  name: 'Field Force',
  slug: 'field-force',
  android: { package: 'com.praversetech.fieldforce' },
  plugins: ['expo-router'],
};
const FILE = '/build/google-services.json';
const exists = (path: string): boolean => path === FILE;

interface Out {
  readonly android: Readonly<Record<string, unknown>>;
  readonly plugins: readonly unknown[];
}
const run = (env: Record<string, string | undefined>): Out => withMapsAndPush(BASE, env, exists);

describe('plugins/maps-push.cjs', () => {
  it('flags off: nothing is written — no key, no Firebase file, no notifications plugin', () => {
    const out = run({ GOOGLE_MAPS_ANDROID_API_KEY: 'AIza-example' });
    expect(out.android.config).toBeUndefined();
    expect(out.android.googleServicesFile).toBeUndefined();
    expect(out.plugins).toEqual(['expo-router']);
  });

  it('maps on: the key goes into the manifest config, from the build environment only', () => {
    const out = run({ EXPO_PUBLIC_MAPS: 'true', GOOGLE_MAPS_ANDROID_API_KEY: ' AIza-example ' });
    expect(out.android.config).toEqual({ googleMaps: { apiKey: 'AIza-example' } });
    expect(out.android.package).toBe('com.praversetech.fieldforce');
  });

  it('push on: the Firebase file and the expo-notifications plugin, and nothing else', () => {
    const out = run({ EXPO_PUBLIC_PUSH: 'true', GOOGLE_SERVICES_JSON: FILE });
    expect(out.android.googleServicesFile).toMatch(/google-services\.json$/u);
    expect(out.plugins).toEqual([
      'expo-router',
      ['expo-notifications', { defaultChannel: 'default' }],
    ]);
  });

  it('a flag on with its input missing throws at config time, naming the variable', () => {
    expect(() => run({ EXPO_PUBLIC_MAPS: 'true' })).toThrow(
      /GOOGLE_MAPS_ANDROID_API_KEY is not set/u,
    );
    expect(() => run({ EXPO_PUBLIC_PUSH: 'true' })).toThrow(/GOOGLE_SERVICES_JSON is not set/u);
    // Only exactly 'true' turns a flag on.
    expect(() => run({ EXPO_PUBLIC_MAPS: 'TRUE' })).not.toThrow();
  });

  it('is applied by app.config.ts, and no key or Firebase file is committed', () => {
    const root = join(__dirname, '..');
    expect(readFileSync(join(root, 'app.config.ts'), 'utf8')).toMatch(/withMapsAndPush\(/u);
    const appJson = readFileSync(join(root, 'app.json'), 'utf8');
    expect(appJson).not.toMatch(/AIza|googleServicesFile|googleMaps/u);
  });
});
