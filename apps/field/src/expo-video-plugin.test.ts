import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `FE-W127` — `expo-video` plays lesson clips while the lesson is ON SCREEN, and nowhere else.
 *
 * Its config plugin adds a foreground media-playback service and two `FOREGROUND_SERVICE*`
 * permissions only when `supportsBackgroundPlayback` is true, and Picture-in-Picture on the main
 * activity only when `supportsPictureInPicture` is true (`node_modules/expo-video/plugin/build`).
 * Both are written out as `false` rather than left to a default, so a future default cannot quietly
 * give a training video a notification-shade player or a floating window.
 */
describe('app.json — the expo-video plugin', () => {
  it('is configured with background playback and Picture-in-Picture both OFF', () => {
    const json = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as {
      expo: { plugins: unknown[]; android: { permissions?: string[] } };
    };
    const entry = json.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-video') as
      [string, Record<string, unknown>] | undefined;
    expect(entry, 'expo-video is not in app.json plugins').toBeDefined();
    expect(entry?.[1]).toEqual({
      supportsBackgroundPlayback: false,
      supportsPictureInPicture: false,
    });
    for (const permission of json.expo.android.permissions ?? []) {
      expect(permission).not.toMatch(/FOREGROUND_SERVICE/u);
    }
  });
});
