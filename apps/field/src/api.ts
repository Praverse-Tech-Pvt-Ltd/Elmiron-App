import { createApiClient } from '@elmiron/core';
import type { ApiClient } from '@elmiron/core';
import { apiBaseUrl } from './config';
import { supabase } from './supabase';

/**
 * Scenarios the mock server serves. Selected with the `x-mock-scenario` header.
 *
 * These exist so the non-happy paths are built from the start rather than
 * retrofitted. `denied` in particular matters: `permission_denied` must reach the
 * UI as a denial and never as an empty list, because an empty list is what a
 * filter-in-the-client bug looks like.
 */
export type MockScenario =
  | 'populated'
  | 'single'
  | 'empty'
  | 'denied'
  | 'unauthenticated'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'error';

const getAccessToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export const createClientForScenario = (scenario?: MockScenario): ApiClient =>
  createApiClient({
    baseUrl: apiBaseUrl,
    getAccessToken,
    // Spread rather than `fetch: undefined` — the repo sets
    // `exactOptionalPropertyTypes`, under which an explicit undefined is not the
    // same as an absent property.
    ...(scenario === undefined
      ? {}
      : {
          fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            // Headers rather than an object spread: `HeadersInit` can be an array
            // of pairs, and spreading that into an object produces numeric keys.
            const headers = new Headers(init?.headers);
            headers.set('x-mock-scenario', scenario);
            return fetch(input, { ...init, headers });
          },
        }),
  });

export const api: ApiClient = createClientForScenario();
