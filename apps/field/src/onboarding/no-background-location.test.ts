import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUESTS_BACKGROUND_LOCATION } from './permissions';

/**
 * FE-D2 first run — **background location is never requested, declared or prepared for.**
 *
 * Operator ruling: foreground location only; the background decision is still open. It is open
 * for a reason `permissions.ts` records — the permission carries a Google Play declaration whose
 * acceptable uses do not include employee monitoring — so shipping a request for it would be
 * taking that decision by accident.
 *
 * A scan rather than a render, because "anywhere in first run" includes code no test renders: a
 * helper a screen calls, a config plugin option, a second screen added later. Every way this repo
 * could ask for background location is listed, and the app's own source must contain none of them.
 * Test files are excluded (this one names them all), and so is build output.
 */

const APP_ROOT = join(__dirname, '..', '..');

/** Each way to ask for, declare or depend on background location. */
const FORBIDDEN = [
  'ACCESS_BACKGROUND_LOCATION',
  'requestBackgroundPermissionsAsync',
  'getBackgroundPermissionsAsync',
  'isAndroidBackgroundLocationEnabled',
  'startLocationUpdatesAsync',
  'startGeofencingAsync',
] as const;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });

const offenders = (): string[] => {
  const files = [
    ...sourceFiles(join(APP_ROOT, 'app')),
    ...sourceFiles(join(APP_ROOT, 'src')),
    join(APP_ROOT, 'app.json'),
    join(APP_ROOT, 'app.config.ts'),
  ];
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const term of FORBIDDEN) {
      // Comments that EXPLAIN the absence are allowed; a call or a string is not. A line whose
      // content before any `//` or inside a `*` block comment names the term is a comment.
      text.split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        const isComment =
          trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//');
        if (!isComment && line.includes(term)) {
          found.push(`${relative(APP_ROOT, file)}:${String(index + 1)} ${term}`);
        }
      });
    }
  }
  return found;
};

describe('FE-D2 first run — no background location, anywhere', () => {
  it('no app source file or app config asks for, declares or uses background location', () => {
    expect(offenders()).toEqual([]);
  });

  it('the recorded decision still says so', () => {
    expect(REQUESTS_BACKGROUND_LOCATION).toBe(false);
  });

  it('POSITIVE CONTROL: the scan actually reads the app — it finds the foreground request', () => {
    // Without this, a scan of the wrong directory would find nothing and pass forever.
    const files = [...sourceFiles(join(APP_ROOT, 'app')), ...sourceFiles(join(APP_ROOT, 'src'))];
    expect(files.length).toBeGreaterThan(20);
    const foreground = files.filter((file) =>
      readFileSync(file, 'utf8').includes('requestForegroundPermissionsAsync()'),
    );
    expect(foreground.length).toBeGreaterThan(0);
  });
});
