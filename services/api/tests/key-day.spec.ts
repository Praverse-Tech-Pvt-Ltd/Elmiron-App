import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_FEATURES,
  GATEWAY_OUTPUT_SCHEMA_NAME,
  PromptModelConfigSchema,
} from '@fieldforce/core';
import {
  CONTENT_DIR,
  DRAFTS_DIR,
  MIGRATIONS_DIR,
  NOTICE_DRAFT,
  OUTPUT_SCHEMA,
  describeFunctionsEnv,
  inspectFunctionsEnv,
  likelyLanAddress,
  migrationGap,
  parseKeyDayArgs,
  parsePracticeDrafts,
  readDraftPrompt,
  refuseRemote,
  testNoticeBody,
} from '../scripts/key-day.mjs';
import { checkCatalogue } from '../scripts/load-catalogue.mjs';
import { checkCourse } from '../scripts/load-course.mjs';
import { checkKnowledge } from '../scripts/load-knowledge.mjs';
import { SWITCHABLE } from '../scripts/ai-switches.mjs';

/**
 * `BE-W205` — `pnpm key-day`'s pure parts, without a database or a network. The run itself is proved
 * against the local stack (the session log records it); this file pins what must never drift:
 * the target refusal, that no value of the AI key is ever reported, and that every input it loads —
 * the drafts and the TEST content — is accepted by the same checks the real loaders and the
 * console apply.
 */

const KEY = 'sk-proj-THIS-MUST-NEVER-BE-PRINTED';

describe('the target', () => {
  const saved = process.env['ELMIRON_ALLOW_REMOTE_TARGET'];
  afterEach(() => {
    if (saved === undefined) delete process.env['ELMIRON_ALLOW_REMOTE_TARGET'];
    else process.env['ELMIRON_ALLOW_REMOTE_TARGET'] = saved;
  });

  it('a local stack runs', () => {
    expect(() => {
      refuseRemote([
        { label: 'API URL', url: 'http://127.0.0.1:54321' },
        { label: 'database URL', url: 'postgresql://postgres:postgres@localhost:54322/postgres' },
      ]);
    }).not.toThrow();
  });

  it('a deployment is refused, NAMING the host — even with the remote opt-in set', () => {
    process.env['ELMIRON_ALLOW_REMOTE_TARGET'] = '1';
    expect(() => {
      refuseRemote([{ label: 'API URL', url: 'https://pgfdbzoapmleqtoezhoa.supabase.co' }]);
    }).toThrow(/key-day refuses to run against host "pgfdbzoapmleqtoezhoa\.supabase\.co"/u);
  });
});

describe('the functions .env: facts about lines, never a value', () => {
  const allText = (env: ReturnType<typeof inspectFunctionsEnv>): string =>
    JSON.stringify(env) + describeFunctionsEnv(env).lines.join('\n');

  it('no file: a WARNING, not a stop, and how to fix it', () => {
    const env = inspectFunctionsEnv(null);
    const said = describeFunctionsEnv(env);
    expect(said.live).toBe(false);
    expect(said.lines.join('\n')).toMatch(/STUB/u);
    expect(said.lines.join('\n')).toMatch(/\.env\.example/u);
  });

  it('openai with a key: live, and the key is nowhere in what is said', () => {
    const env = inspectFunctionsEnv(`AI_PROVIDER=openai\r\nOPENAI_API_KEY=${KEY}\r\n`);
    expect(env).toMatchObject({ provider: 'openai', openAiKey: 'present', glued: false });
    expect(describeFunctionsEnv(env).live).toBe(true);
    expect(allText(env)).not.toContain(KEY);
  });

  it('the .env.example copied unchanged: the placeholder is recognised, not taken for a key', () => {
    const example = readFileSync(
      new URL('../supabase/functions/.env.example', import.meta.url),
      'utf8',
    );
    const env = inspectFunctionsEnv(example);
    expect(env).toMatchObject({ provider: 'openai', openAiKey: 'placeholder' });
    expect(describeFunctionsEnv(env).live).toBe(false);
  });

  it('two settings glued by `echo >>`: flagged, not live, and the key is NOT printed', () => {
    const env = inspectFunctionsEnv(
      `AWS_REGION=ap-south-1\nAI_PROVIDER=openaiOPENAI_API_KEY=${KEY}`,
    );
    expect(env.glued).toBe(true);
    expect(env.provider).toBe('unreadable');
    expect(describeFunctionsEnv(env).live).toBe(false);
    expect(allText(env)).not.toContain(KEY);
  });

  it('no provider: the stub, said plainly', () => {
    const said = describeFunctionsEnv(inspectFunctionsEnv(`OPENAI_API_KEY=${KEY}\n`));
    expect(said.live).toBe(false);
    expect(said.lines.join('\n')).toMatch(/AI_PROVIDER is not set/u);
  });
});

describe('the migrations, compared by version', () => {
  it('equal sets pass; a missing or an unknown version is named', () => {
    const files = ['20260101000100_a.sql', '20260101000200_b.sql', 'README.md'];
    expect(migrationGap(files, ['20260101000100', '20260101000200'])).toMatchObject({
      onDisk: 2,
      missing: [],
      unknown: [],
    });
    expect(migrationGap(files, ['20260101000100', '20990101000000'])).toMatchObject({
      missing: ['20260101000200'],
      unknown: ['20990101000000'],
    });
  });

  it('every real migration file has a version prefix', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) expect(f).toMatch(/^\d{14}_/u);
  });
});

describe('what it approves is what the console and the gateway accept', () => {
  it('the schema map is the gateway’s, for exactly the switchable features', () => {
    expect(OUTPUT_SCHEMA).toEqual(GATEWAY_OUTPUT_SCHEMA_NAME);
    expect([...SWITCHABLE].sort()).toEqual([...GATEWAY_FEATURES].sort());
  });

  it('each draft instruction set: DRAFT text, and model limits the console would accept', () => {
    for (const feature of GATEWAY_FEATURES) {
      const draft = readDraftPrompt(feature, readFileSync(`${DRAFTS_DIR}${feature}.md`, 'utf8'));
      expect(draft.text.startsWith('DRAFT')).toBe(true);
      expect(PromptModelConfigSchema.safeParse(draft.modelConfig).success, feature).toBe(true);
    }
  });

  it('the practice drafts: five personas, five scenarios loaded, S6 held back for D-15', () => {
    const p = parsePracticeDrafts(readFileSync(`${DRAFTS_DIR}personas-and-scenarios.md`, 'utf8'));
    expect(p.personas.map((x) => x.code)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    for (const persona of p.personas) {
      expect(['receptive', 'sceptical', 'rushed', 'hostile']).toContain(persona.stance);
      expect(persona.brief.startsWith('DRAFT')).toBe(true);
    }
    expect(p.scenarios.map((x) => x.code)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    for (const s of p.scenarios) {
      expect(p.personas.map((x) => x.code)).toContain(s.persona);
      expect(s.title).not.toMatch(/^"|"$/u);
    }
    expect(p.skipped).toEqual([{ code: 'S6', why: expect.stringMatching(/D-15/u) as unknown }]);
  });

  it('the TEST content passes the real loaders’ checks, and says it is TEST', () => {
    const read = (n: string): string => readFileSync(`${CONTENT_DIR}${n}.md`, 'utf8');
    const catalogue = checkCatalogue(read('catalogue'));
    const course = checkCourse(read('course'));
    const knowledge = checkKnowledge(read('knowledge'));
    expect([catalogue.problems, course.problems, knowledge.problems]).toEqual([[], [], []]);
    expect(course.course.title).toMatch(/^TEST /u);
    expect(knowledge.doc.title).toMatch(/^TEST /u);
    expect(catalogue.catalogue.products.map((x) => x.brand)).toEqual(['Testoval TEST']);
  });

  it('the TEST notice fits the table’s bounds and says it is a test', () => {
    const body = testNoticeBody(readFileSync(NOTICE_DRAFT, 'utf8'));
    expect(body.length).toBeGreaterThanOrEqual(50);
    expect(body.length).toBeLessThanOrEqual(20_000);
    expect(body.startsWith('TEST COMPANY')).toBe(true);
    expect(body).toContain('## Location sharing');
  });
});

describe('the command line', () => {
  it('--fresh and --help only; anything else is refused by name', () => {
    expect(parseKeyDayArgs([])).toEqual({ fresh: false, help: false, problems: [] });
    expect(parseKeyDayArgs(['--fresh']).fresh).toBe(true);
    expect(parseKeyDayArgs(['--prod']).problems[0]).toMatch(/"--prod"/u);
  });

  it('the APK address prefers the Wi-Fi adapter and never a virtual one', () => {
    const v4 = (address: string, internal = false) =>
      ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as const;
    expect(
      likelyLanAddress({
        'vEthernet (WSL)': [v4('172.20.0.1')],
        'Wi-Fi': [v4('192.168.1.15')],
        Loopback: [v4('127.0.0.1', true)],
      }),
    ).toEqual({ name: 'Wi-Fi', address: '192.168.1.15' });
    expect(likelyLanAddress({ 'vEthernet (WSL)': [v4('172.20.0.1')] })).toBeNull();
  });
});
