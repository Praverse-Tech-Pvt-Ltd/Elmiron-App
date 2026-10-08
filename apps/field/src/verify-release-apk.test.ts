import { describe, expect, it } from 'vitest';
import { judgeSigners } from '../scripts/verify-release-apk.mjs';

/**
 * W2-I C3 (`BE-W169`) — the decision `verify-release-apk.mjs` makes on `apksigner --print-certs`
 * output. The live run against today's demo APK is in the log (refused: the debug key). There is no
 * release key yet, so the ACCEPTING path can be shown only on text shaped like apksigner's.
 */
const DEBUG_SHA = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const RELEASE_SHA = 'ab'.repeat(32);
const signer = (n: number, dn: string, sha: string): string =>
  `Signer #${String(n)} certificate DN: ${dn}\nSigner #${String(n)} certificate SHA-256 digest: ${sha}\n`;
const DEBUG = signer(
  1,
  'CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US',
  DEBUG_SHA,
);
const RELEASE = signer(1, 'CN=Praverse Tech, O=Praverse Tech Pvt Ltd, C=IN', RELEASE_SHA);

describe('W2-I C3 — who signed this APK', () => {
  it('ACCEPTS one signer, not the debug key, whose fingerprint is the expected one', () => {
    expect(judgeSigners(RELEASE, RELEASE_SHA)).toEqual({
      ok: true,
      problems: [],
      signers: [{ dn: 'CN=Praverse Tech, O=Praverse Tech Pvt Ltd, C=IN', sha256: RELEASE_SHA }],
    });
    // Colons and capitals, as keytool prints a fingerprint, are the same fingerprint.
    const keytoolStyle = (RELEASE_SHA.toUpperCase().match(/../gu) ?? []).join(':');
    expect(judgeSigners(RELEASE, keytoolStyle).ok).toBe(true);
  });

  it('REFUSES the debug key — even when told to expect exactly it', () => {
    const verdict = judgeSigners(DEBUG, DEBUG_SHA);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toEqual([
      'signed with the PUBLIC ANDROID DEBUG KEY — anyone can sign an update to this app',
    ]);
  });

  it('REFUSES a signer that is not the expected key', () => {
    expect(judgeSigners(RELEASE, 'cd'.repeat(32)).problems).toEqual([
      'the signer is NOT the expected release key',
    ]);
  });

  it('REFUSES with no fingerprint to check against, or one that is not a fingerprint', () => {
    expect(judgeSigners(RELEASE, undefined).ok).toBe(false);
    expect(judgeSigners(RELEASE, 'abc').problems).toEqual([
      '--expect-sha256 is not a SHA-256 fingerprint (64 hex digits, colons allowed)',
    ]);
  });

  it('REFUSES an unsigned or unverifiable APK, and two signers', () => {
    expect(judgeSigners('DOES NOT VERIFY\n', RELEASE_SHA).problems).toEqual([
      'no signer found — the APK is unsigned or did not verify',
    ]);
    const two = RELEASE + signer(2, 'CN=Someone Else', 'cd'.repeat(32));
    expect(judgeSigners(two, RELEASE_SHA).problems).toEqual([
      '2 signers; a release has exactly one',
    ]);
  });
});
