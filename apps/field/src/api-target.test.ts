import { describe, expect, it } from 'vitest';
import { DEV_FALLBACK_API, resolveApiTarget } from './api-target';

/**
 * FE-D2 2 — a release build never falls back to the mock on `127.0.0.1`.
 *
 * `config.ts` used to read `process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4010'` in
 * every build. In a release APK with the variable unset, `127.0.0.1` is the phone itself, so the
 * six mock-reading screens failed on every real device with nothing saying why. The operator's
 * ruling: release with no real address stops at a configuration error; dev keeps the fallback.
 */

const RELEASE = { dev: false } as const;
const DEV = { dev: true } as const;

describe('resolveApiTarget — release', () => {
  it('refuses an unset address instead of falling back to 127.0.0.1', () => {
    const target = resolveApiTarget(undefined, RELEASE);
    expect(target.kind).toBe('misconfigured');
    expect(JSON.stringify(target)).not.toContain('127.0.0.1:4010');
  });

  it('refuses an empty or blank address', () => {
    expect(resolveApiTarget('', RELEASE).kind).toBe('misconfigured');
    expect(resolveApiTarget('   ', RELEASE).kind).toBe('misconfigured');
  });

  it('refuses a loopback address set explicitly — on a phone that is the phone', () => {
    // `.env.example` sets exactly this. A release built from a copied example is the likely
    // way to ship the defect, so it is refused as firmly as an unset value.
    for (const value of ['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010']) {
      expect(resolveApiTarget(value, RELEASE).kind).toBe('misconfigured');
    }
  });

  it('refuses something that is not a URL', () => {
    expect(resolveApiTarget('api.example.com', RELEASE).kind).toBe('misconfigured');
    expect(resolveApiTarget('ftp://api.example.com', RELEASE).kind).toBe('misconfigured');
  });

  it('names what is wrong, so whoever built it can fix it', () => {
    const target = resolveApiTarget(undefined, RELEASE);
    expect(target.kind === 'misconfigured' ? target.reason : '').toContain(
      'EXPO_PUBLIC_API_BASE_URL',
    );
  });

  it('POSITIVE CONTROL: accepts a real address, unchanged', () => {
    expect(resolveApiTarget('https://api.example.com', RELEASE)).toEqual({
      kind: 'ok',
      baseUrl: 'https://api.example.com',
    });
    // A LAN address is how a release build is pointed at a laptop on the same WiFi. It is a
    // real address from the phone's point of view, so it is not refused.
    expect(resolveApiTarget('http://192.168.1.20:4010', RELEASE).kind).toBe('ok');
  });
});

describe('resolveApiTarget — dev keeps the fallback', () => {
  it('falls back to the local mock when unset', () => {
    expect(resolveApiTarget(undefined, DEV)).toEqual({ kind: 'ok', baseUrl: DEV_FALLBACK_API });
    expect(DEV_FALLBACK_API).toBe('http://127.0.0.1:4010');
  });

  it('uses the address it was given, loopback included', () => {
    expect(resolveApiTarget('http://127.0.0.1:4010', DEV)).toEqual({
      kind: 'ok',
      baseUrl: 'http://127.0.0.1:4010',
    });
  });
});
