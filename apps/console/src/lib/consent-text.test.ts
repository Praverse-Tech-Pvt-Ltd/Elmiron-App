import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { consentTextVersions } from './consent-text';
import type { TableReader } from './consent-text';

/**
 * MR-52 A2 — `FE-W66`: the console reads consent notices from the real table, and no console page
 * builds a client without an identity ever again.
 */
const row = {
  id: '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01',
  version_label: 'v1.2',
  language: 'en-IN',
  full_text: 'We would like to record this conversation.',
  hash: 'a'.repeat(64),
  effective_from: '2026-09-01T00:00:00+00:00',
  effective_until: null,
  created_at: '2026-09-01T00:00:00+00:00',
};

const reader = (answer: { data: unknown[] | null; error: { message: string } | null }) => {
  const order = vi.fn(() => Promise.resolve(answer));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { db: { from } as unknown as TableReader, from, select, order };
};

describe('MR-52 A2 — the consent notices, from the table', () => {
  it('maps the table’s own column names to the contract', async () => {
    const r = reader({ data: [row], error: null });
    const versions = await consentTextVersions(r.db);

    expect(r.from).toHaveBeenCalledWith('consent_text_versions');
    // Newest first: this list is read to see which notice was live when.
    expect(r.order).toHaveBeenCalledWith('effective_from', { ascending: false });
    expect(versions).toEqual([
      {
        id: row.id,
        versionLabel: 'v1.2',
        language: 'en-IN',
        fullText: row.full_text,
        hash: row.hash,
        effectiveFrom: row.effective_from,
        effectiveUntil: null,
        createdAt: row.created_at,
      },
    ]);
  });

  it('throws when the read failed, rather than showing a shortened list', async () => {
    const r = reader({ data: null, error: { message: 'permission denied' } });
    await expect(consentTextVersions(r.db)).rejects.toThrow('permission denied');
  });

  it('a row that does not fit the contract throws rather than being dropped', async () => {
    const r = reader({ data: [row, { ...row, hash: 'too-short' }], error: null });
    await expect(consentTextVersions(r.db)).rejects.toThrow();
  });
});

/**
 * The regression guard for `FE-W66` itself.
 *
 * Every console page used to build `createApiClient({ ..., getAccessToken: () => null })` and read
 * the mock. A test that only checked one page would not stop the next one being written that way,
 * so this reads the source of all of them — the catalogue locates, and this decides.
 */
/** The code, without its prose: a comment that QUOTES the old defect must not read as the defect. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });

describe('MR-52 A2 — no console source reads without an identity', () => {
  const files = sourceFiles(join(import.meta.dirname, '..'));

  it('reads a non-trivial number of files, so the checks below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('no page builds a client with a null token', () => {
    const offenders = files.filter((file) =>
      /getAccessToken:\s*\(\)\s*=>\s*(Promise\.resolve\()?null/u.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('no page points at the mock on :4010', () => {
    const offenders = files.filter((file) => code(file).includes(':4010'));
    expect(offenders).toEqual([]);
  });
});
