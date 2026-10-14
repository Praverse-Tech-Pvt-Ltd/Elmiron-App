import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `FE-W194` — the app's icon, and the words the phone shows when it asks for the microphone.
 *
 * The icon is a PLACEHOLDER (the console's leaf, white on the brand green) until the client supplies
 * its own; what is pinned here is that every path `app.json` names exists, is a 1024 × 1024 PNG as
 * both stores ask, and that the adaptive icon's ground is the brand green rather than Expo's white.
 * The microphone text is read by the phone, outside the app, so it must not name a brand the client
 * has not chosen: the display name is configuration (`app.config.ts`, "Field Force" by default).
 */
interface AppJson {
  readonly expo: {
    readonly icon?: string;
    readonly ios: { readonly icon?: string };
    readonly android: {
      readonly adaptiveIcon?: {
        readonly foregroundImage?: string;
        readonly backgroundColor?: string;
      };
    };
    readonly plugins: readonly (string | readonly [string, Record<string, unknown>])[];
  };
}

const APP = join(__dirname, '..');
const appJson = (): AppJson => JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')) as AppJson;

/** Width and height from a PNG's IHDR chunk, which always follows the 8-byte signature. */
const pngSize = (path: string): { width: number; height: number } => {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

describe('app.json — the icon (FE-W194)', () => {
  it('names an icon for the app, for iOS and for Android’s adaptive icon', () => {
    const { expo } = appJson();
    expect(expo.icon).toBe('./assets/icon.png');
    expect(expo.ios.icon).toBe('./assets/icon.png');
    expect(expo.android.adaptiveIcon?.foregroundImage).toBe('./assets/adaptive-icon.png');
    // The brand green (`palette.accent`), so the launcher's mask never shows a white ground.
    expect(expo.android.adaptiveIcon?.backgroundColor).toBe('#35593A');
  });

  it('every image it names is in the repository, 1024 × 1024', () => {
    const { expo } = appJson();
    for (const path of [expo.icon, expo.ios.icon, expo.android.adaptiveIcon?.foregroundImage]) {
      expect(path).toBeDefined();
      const file = join(APP, path ?? '');
      expect(existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual({ width: 1024, height: 1024 });
    }
  });
});

describe('app.json — the microphone question (FE-W194)', () => {
  it('names no brand: the app’s name is the client’s decision', () => {
    const audio = appJson().expo.plugins.find(
      (plugin): plugin is readonly [string, Record<string, unknown>] =>
        Array.isArray(plugin) && plugin[0] === 'expo-audio',
    );
    const value = audio?.[1]['microphonePermission'];
    const text = typeof value === 'string' ? value : '';
    expect(text).toMatch(/^This app records /u);
    expect(text).not.toMatch(/Elmiron|Field Force/u);
  });
});
