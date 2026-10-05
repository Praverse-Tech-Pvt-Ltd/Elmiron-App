/**
 * Types for W1-W D's check: the Edge Function's `deno.json` names exactly the versions `pnpm-lock.yaml`
 * resolves for the workspaces that test them. Pure, so every failure is provable without a deploy.
 */

/** Package name → the versions the lockfile's `importers` resolve it to. */
export declare const resolvedInImporters: (lockText: string) => Map<string, Set<string>>;

export declare const compareFunctionPins: (
  denoJsonText: string,
  lockText: string,
) => { clear: boolean; failures: string[] };
