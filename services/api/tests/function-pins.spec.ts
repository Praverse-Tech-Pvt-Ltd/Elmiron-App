import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareFunctionPins } from '../scripts/check-function-pins.mjs';

/**
 * W1-W D — the Edge Function's `deno.json` and the tests' `pnpm-lock.yaml` must name the same version
 * of every package they share. Each case changes ONE thing from an agreeing pair.
 */

const LOCK = `lockfileVersion: '9.0'

importers:

  packages/core:
    dependencies:
      zod:
        specifier: ^4.1.12
        version: 4.4.3

  services/api:
    devDependencies:
      '@aws-sdk/client-bedrock-runtime':
        specifier: 3.1144.0
        version: 3.1144.0

packages:

  zod@9.9.9:
    resolution: {integrity: sha512-x}
`;

const deno = (imports: Record<string, string>) => JSON.stringify({ imports });
const AGREEING = {
  zod: 'npm:zod@4.4.3',
  '@aws-sdk/client-bedrock-runtime': 'npm:@aws-sdk/client-bedrock-runtime@3.1144.0',
};

describe('W1-W D — the function runs what the tests run', () => {
  it('POSITIVE CONTROL: the repository as committed agrees', () => {
    const result = compareFunctionPins(
      readFileSync(new URL('../supabase/functions/deno.json', import.meta.url), 'utf8'),
      readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'),
    );
    expect(result).toEqual({ clear: true, failures: [] });
  });

  it('an agreeing pair is clear', () => {
    expect(compareFunctionPins(deno(AGREEING), LOCK).clear).toBe(true);
  });

  it('the SDK drifting by one patch version FAILS, naming both versions', () => {
    const result = compareFunctionPins(
      deno({
        ...AGREEING,
        '@aws-sdk/client-bedrock-runtime': 'npm:@aws-sdk/client-bedrock-runtime@3.1145.0',
      }),
      LOCK,
    );
    expect(result.clear).toBe(false);
    expect(result.failures).toEqual([
      '@aws-sdk/client-bedrock-runtime: the function runs 3.1145.0; the tests run 3.1144.0. Make them the same',
    ]);
  });

  it('a RANGE fails even when it would match today — it is resolved on deploy day', () => {
    const result = compareFunctionPins(deno({ ...AGREEING, zod: 'npm:zod@^4.1.12' }), LOCK);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/^zod: .*RANGE/u);
  });

  it('a package no workspace resolves fails — nothing tests it', () => {
    const result = compareFunctionPins(deno({ ...AGREEING, ky: 'npm:ky@1.2.3' }), LOCK);
    expect(result.failures).toEqual([
      'ky: in deno.json but no workspace in pnpm-lock.yaml resolves it, so no test runs it',
    ]);
  });

  it('a version only in the lockfile PACKAGES section, not an importer, does not count', () => {
    // `zod@9.9.9` above is resolved for nobody; matching it would be matching the wrong section.
    const result = compareFunctionPins(deno({ ...AGREEING, zod: 'npm:zod@9.9.9' }), LOCK);
    expect(result.failures).toEqual([
      'zod: the function runs 9.9.9; the tests run 4.4.3. Make them the same',
    ]);
  });
});
