#!/usr/bin/env node
/**
 * W2-I C3 (`BE-W169`) — before an APK goes near a real phone: who signed it?
 *
 *   node apps/field/scripts/verify-release-apk.mjs <file.apk> --expect-sha256 <fingerprint>
 *
 * Runs the Android SDK's `apksigner verify --print-certs` and REFUSES (exit 1) unless:
 *   - the signature verifies;
 *   - there is exactly one signer;
 *   - it is not the public Android debug key (CN=Android Debug), which anyone can sign with;
 *   - its SHA-256 certificate fingerprint equals `--expect-sha256` — the fingerprint of the company's
 *     release key, which the operator records when the key is made. A fingerprint is public; the key
 *     and its passwords never pass through this script.
 * Without `--expect-sha256` it still refuses, and prints what it found, so the operator can compare.
 *
 * It holds no key and makes nothing. A demo APK is refused by design: it is debug-signed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const normalise = (hex) => hex.replace(/[\s:]/gu, '').toLowerCase();

/**
 * Read `apksigner verify --print-certs` output and decide. Pure.
 * @param {string} output
 * @param {string | undefined} expectedSha256
 * @returns {{ ok: boolean; problems: string[]; signers: { dn: string; sha256: string }[] }}
 */
export const judgeSigners = (output, expectedSha256) => {
  const signers = [];
  for (const m of output.matchAll(/^Signer #(\d+) certificate DN: (.*)$/gmu)) {
    const sha = new RegExp(
      `^Signer #${m[1] ?? ''} certificate SHA-256 digest: ([0-9a-fA-F:]+)$`,
      'mu',
    ).exec(output);
    signers.push({ dn: (m[2] ?? '').trim(), sha256: normalise(sha?.[1] ?? '') });
  }
  const problems = [];
  if (signers.length === 0)
    problems.push('no signer found — the APK is unsigned or did not verify');
  if (signers.length > 1)
    problems.push(`${String(signers.length)} signers; a release has exactly one`);
  for (const s of signers) {
    if (/CN=Android Debug/iu.test(s.dn))
      problems.push(
        'signed with the PUBLIC ANDROID DEBUG KEY — anyone can sign an update to this app',
      );
  }
  const want = normalise(expectedSha256 ?? '');
  if (want === '') {
    problems.push('no --expect-sha256 given: the signer cannot be checked against the release key');
  } else if (!/^[0-9a-f]{64}$/u.test(want)) {
    problems.push('--expect-sha256 is not a SHA-256 fingerprint (64 hex digits, colons allowed)');
  } else if (signers.length === 1 && signers[0]?.sha256 !== want) {
    problems.push('the signer is NOT the expected release key');
  }
  return { ok: problems.length === 0, problems, signers };
};

/** The newest `apksigner` in the Android SDK. */
const findApksigner = () => {
  const sdk =
    process.env['ANDROID_HOME'] ?? join(process.env['LOCALAPPDATA'] ?? '', 'Android', 'Sdk');
  const tools = join(sdk, 'build-tools');
  if (!existsSync(tools)) throw new Error(`no Android build-tools under ${sdk}; set ANDROID_HOME`);
  const versions = readdirSync(tools).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const dir = join(tools, versions.at(-1) ?? '');
  const bat = join(dir, 'apksigner.bat');
  return existsSync(bat) ? bat : join(dir, 'apksigner');
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  const args = process.argv.slice(2);
  const apk = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect-sha256');
  const expected = args.includes('--expect-sha256')
    ? args[args.indexOf('--expect-sha256') + 1]
    : undefined;
  if (apk === undefined || !existsSync(apk)) {
    console.error('usage: verify-release-apk.mjs <file.apk> --expect-sha256 <fingerprint>');
    process.exit(2);
  }
  let output = '';
  try {
    const signer = findApksigner();
    output = execFileSync(signer, ['verify', '--print-certs', apk], {
      encoding: 'utf8',
      shell: signer.endsWith('.bat'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // A verification failure exits non-zero; its output is still read below.
    output = String(/** @type {{ stdout?: unknown }} */ (error).stdout ?? '');
  }
  const verdict = judgeSigners(output, expected);
  for (const s of verdict.signers) console.log(`signer: ${s.dn}\n  SHA-256: ${s.sha256}`);
  if (!verdict.ok) {
    console.error(
      `REFUSED — do not install ${apk} on a phone:\n${verdict.problems.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`OK — ${apk} is signed by the expected release key, and only by it.`);
}
