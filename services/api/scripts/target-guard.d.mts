/**
 * Types for `target-guard.mjs`, which is plain `.mjs` like every script in this directory.
 *
 * The scripts deliberately do not import `packages/core` — `scripts-convention.spec.ts`
 * guards that, because the retention workflows run them with no build step. A declaration
 * file is how the suite gets types without the script gaining a compile step.
 */

/** `127.0.0.1`, `::1`, `localhost`. */
export declare const LOCALHOST_HOSTS: ReadonlySet<string>;

/** The environment variable a deployment target must be opted into with: `'1'` exactly. */
export declare const REMOTE_OPT_IN: string;

/** The URL's hostname, unbracketed, or `null` when it will not parse. */
export declare const hostOf: (url: string) => string | null;

export declare const isLocalHost: (url: string) => boolean;

export interface TargetGuardArgs {
  /** What the operator typed, e.g. `purge:audio`. Appears in the refusal. */
  readonly command: string;
  /** Which URL this is, e.g. `database URL`. Appears in the refusal. */
  readonly label: string;
  readonly url: string;
  /** What running against that host would do. Appears in the refusal. */
  readonly consequence: string;
  readonly env?: Record<string, string | undefined>;
}

/**
 * Throws unless the target is local or the opt-in is set.
 *
 * **The thrown message NAMES THE HOST**, because `getaddrinfo ENOTFOUND` is what a missing
 * guard looks like and a test satisfied by any error would certify nothing.
 */
export declare const assertTargetAllowed: (args: TargetGuardArgs) => void;
