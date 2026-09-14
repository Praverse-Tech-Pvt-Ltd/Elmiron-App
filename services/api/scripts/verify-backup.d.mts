/**
 * Types for the backup verifier — `BE-W11`.
 *
 * The digest check is exported separately because a corrupted or truncated artefact is the
 * failure a backup system is most likely to have and least likely to notice, and asserting it
 * should not require producing a 17 MB dump.
 */

/** Does the file on disk hash to what the manifest recorded? */
export declare const checkDigest: (
  bytes: Buffer,
  expected: string,
) => { ok: boolean; actual: string };
