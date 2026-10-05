import { describe, expect, it } from 'vitest';
import {
  WRITER_PATH,
  checkServiceRoleReads,
  loadRepository,
} from '../scripts/check-service-role-reads.mjs';
import type { SourceFile } from '../scripts/check-service-role-reads.mjs';

/**
 * W2-A A (`BE-C70`) — the service-role key is read in exactly one place, and the build fails otherwise.
 *
 * `C30` guaranteed by ABSENCE that nobody in a hurry could reach for the key; `BE-C69` spent that. This
 * proves the replacement both ways: the repository as committed passes, and each way of reaching the
 * key a second time — changed in a COPY of the real files — fails, naming the file.
 */

const repo = loadRepository();
const KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/** The real files, with one file's text changed. */
const withFile = (path: string, change: (text: string) => string): SourceFile[] =>
  repo.functions.map((f) => (f.path === path ? { path, text: change(f.text) } : f));
const failuresFor = (functions: SourceFile[], core = repo.core) =>
  checkServiceRoleReads(functions, core);

describe('W2-A A — the service-role key is reachable from exactly one place', () => {
  it('POSITIVE CONTROL: the repository as committed passes', () => {
    expect(repo.functions.map((f) => f.path)).toContain(WRITER_PATH);
    expect(repo.functions.length).toBeGreaterThan(3);
    expect(failuresFor(repo.functions)).toEqual([]);
  });

  it('a SECOND read, in the gateway, fails — naming both places', () => {
    const failures = failuresFor(
      withFile('ai-gateway/index.ts', (t) => `${t}\nconst hurried = Deno.env.get('${KEY}');\n`),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/found 2: .*ai-gateway\/index\.ts ×1/u);
  });

  it('the name parked in a variable elsewhere fails too — it is not only reads that count', () => {
    const failures = failuresFor(
      withFile('_shared/stub-provider.ts', (t) => `${t}\nconst NAME = '${KEY}';\n`),
    );
    expect(failures.join('\n')).toMatch(/_shared\/stub-provider\.ts ×1/u);
  });

  it('reading the WHOLE environment fails — it includes the key', () => {
    const failures = failuresFor(
      withFile('_shared/stub-provider.ts', (t) => `${t}\nconst all = Deno.env.toObject();\n`),
    );
    expect(failures).toEqual([
      expect.stringMatching(/stub-provider\.ts: reads the WHOLE environment/u),
    ]);
  });

  it('a read whose variable name is computed fails — it could be the key under another spelling', () => {
    const failures = failuresFor(
      withFile('ai-gateway/index.ts', (t) => `${t}\nconst v = Deno.env.get(name);\n`),
    );
    expect(failures).toEqual([expect.stringMatching(/index\.ts: Deno\.env\.get\(name\)/u)]);
  });

  it('the writer exporting anything more — the client, the key — fails', () => {
    const failures = failuresFor(
      withFile(WRITER_PATH, (t) => `${t}\nexport const leaked = 'x';\n`),
    );
    expect(failures).toEqual([expect.stringMatching(/must export only practiceWriterFromEnv/u)]);
  });

  it('widening the writer’s allow-list fails', () => {
    const failures = failuresFor(
      withFile(WRITER_PATH, (t) =>
        t.replace(
          "'record_sim_coach_analysis'",
          "'record_sim_coach_analysis', 'ai_complete_request'",
        ),
      ),
    );
    expect(failures).toEqual([expect.stringMatching(/allow-list must be exactly/u)]);
  });

  it('the read moved out of the writer — none left there — fails', () => {
    const functions = withFile(WRITER_PATH, (t) =>
      t.replace(`Deno.env.get('${KEY}')`, "Deno.env.get('SOMETHING_ELSE')"),
    );
    expect(failuresFor(functions)).toEqual([expect.stringMatching(/found 0: nowhere/u)]);
  });

  it('ONE read, in the WRONG place — moved to the gateway — fails', () => {
    // Added after a mutant survived: "exactly one read" alone passed this, because the count was right
    // and only the place was wrong.
    const moved = withFile(WRITER_PATH, (t) =>
      t.replace(`Deno.env.get('${KEY}')`, "Deno.env.get('SOMETHING_ELSE')"),
    ).map((f) =>
      f.path === 'ai-gateway/index.ts'
        ? { path: f.path, text: `${f.text}\nconst k = Deno.env.get('${KEY}');\n` }
        : f,
    );
    expect(failuresFor(moved)).toEqual([
      expect.stringMatching(/found 1: ai-gateway\/index\.ts ×1/u),
    ]);
  });

  it('core starting to read the environment fails — the function imports it', () => {
    const core = [
      ...repo.core,
      { path: 'field/x.ts', text: 'export const k = process.env.ANYTHING;' },
    ];
    expect(failuresFor(repo.functions, core)).toEqual([
      expect.stringMatching(/packages\/core\/field\/x\.ts: reads the environment/u),
    ]);
  });

  it('POSITIVE CONTROL: the key named in a COMMENT elsewhere is not a read', () => {
    const functions = withFile('ai-gateway/index.ts', (t) => `${t}\n// see ${KEY} in the writer\n`);
    expect(failuresFor(functions)).toEqual([]);
  });
});
