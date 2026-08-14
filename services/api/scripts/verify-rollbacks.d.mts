/**
 * Types for the rollback verifier.
 *
 * `assertLocalhostOnly` is pure and exported separately from the rest of the script
 * so the refusal is provable without a real remote database.
 */

export declare const assertLocalhostOnly: (dbUrl: string) => void;

export declare const verifyRollbacks: (overrides?: { dbUrl?: string }) => Promise<void>;
