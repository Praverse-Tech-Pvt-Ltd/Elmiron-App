import { isLocalTarget } from '@fieldforce/core';

/**
 * FE-D2 2 — where the API lives, decided once, and refused rather than guessed in a release build.
 *
 * **Why this is not a default any more.** `config.ts` read
 * `EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4010'` in every build. On a laptop that is the
 * mock; in a release APK it is the phone itself, so every screen that reads through
 * `createClientForScenario` failed on a real device, with nothing anywhere saying the build was
 * the cause. The operator's ruling: **a release build with no real address stops at a
 * configuration error; a dev build keeps the fallback.**
 *
 * The shape follows `loadAppConfig` in `@fieldforce/core`: a pure function that refuses rather
 * than defaults, and names what it refused. It returns a result instead of throwing because a
 * throw at import time crashes a release build with no screen at all, and the ruling asks for a
 * screen — `app/_layout.tsx` renders `ConfigurationError` from this value.
 */

export const DEV_FALLBACK_API = 'http://127.0.0.1:4010';

export type ApiTarget =
  | { readonly kind: 'ok'; readonly baseUrl: string }
  | { readonly kind: 'misconfigured'; readonly reason: string };

const misconfigured = (reason: string): ApiTarget => ({ kind: 'misconfigured', reason });

export const resolveApiTarget = (
  value: string | undefined,
  build: { readonly dev: boolean },
): ApiTarget => {
  const given = value?.trim() ?? '';

  if (build.dev) return { kind: 'ok', baseUrl: given === '' ? DEV_FALLBACK_API : given };

  if (given === '') {
    return misconfigured(
      'EXPO_PUBLIC_API_BASE_URL is not set in this release build, so it has no server to talk to.',
    );
  }

  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return misconfigured(`EXPO_PUBLIC_API_BASE_URL is not a web address: "${given}".`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return misconfigured(`EXPO_PUBLIC_API_BASE_URL is not a web address: "${given}".`);
  }

  // `.env.example` sets the loopback mock, so a release built from a copied example is the
  // likeliest way to ship the defect. On a phone, loopback is the phone.
  if (isLocalTarget(given)) {
    return misconfigured(
      `EXPO_PUBLIC_API_BASE_URL points at ${url.hostname}, which on a phone is the phone itself.`,
    );
  }

  return { kind: 'ok', baseUrl: given };
};
