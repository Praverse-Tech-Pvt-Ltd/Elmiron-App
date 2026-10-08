import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireDatabase } from './db.js';
import { ANON_KEY, API_URL, signIn } from './auth.js';
import { checkCatalogue, loadCatalogue } from '../scripts/load-catalogue.mjs';
import { checkCourse, loadCourse } from '../scripts/load-course.mjs';
import { checkKnowledge, loadKnowledge } from '../scripts/load-knowledge.mjs';
import { contentStep } from '../scripts/content-step.mjs';

/**
 * W2-I A — the catalogue loader. The checks run anywhere; the loads run against the local stack, as a
 * throwaway company's own admin (`seed-practice-world.mjs`) that starts with NO markets and NO
 * products — the state in which the other two loaders refused everything.
 */
const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/operator/${name}`, import.meta.url), 'utf8');
const codes = (problems: { code: string }[]): string[] => problems.map((p) => p.code);
const CAT = (body: string, header = 'catalogue: Acme') => `---\n${header}\n---\n${body}`;

describe('W2-I A2 — the catalogue file is checked, every problem by line, before anything', () => {
  it('the SAMPLE is refused by name, and for nothing else — it is otherwise a valid catalogue', () => {
    const text = sample('catalogue-template.md');
    expect(codes(checkCatalogue(text).problems)).toEqual(['example_content']);
    const renamed = checkCatalogue(text.replace('catalogue: EXAMPLE — ', 'catalogue: '));
    expect(renamed.problems).toEqual([]);
    expect(renamed.catalogue.markets).toMatchObject([{ code: 'IN', name: 'India' }]);
    expect(renamed.catalogue.products).toMatchObject([
      { brand: 'Benchmarol', generic: 'benchmarolum', area: 'Pain', markets: ['IN'] },
    ]);
  });

  it('each refusal, by its code and line', () => {
    const one = (body: string, header?: string) => checkCatalogue(CAT(body, header)).problems;
    expect(codes(one('## Markets\nIN | India', ''))).toEqual(['missing_field']);
    expect(one('## Markets\nIN | India\n## Regions\nX')).toMatchObject([
      { code: 'unknown_section', line: 6 },
      { code: 'stray_text', line: 7 },
    ]);
    expect(one('IN | India')).toMatchObject([{ code: 'stray_text', line: 4 }]);
    expect(codes(one('## Markets\nIN India'))).toEqual(['bad_market_line']);
    expect(codes(one('## Markets\nin | India'))).toEqual(['bad_country_code']);
    expect(codes(one('## Markets\nIN | '))).toEqual(['empty_name']);
    expect(one('## Markets\nIN | India\nIN | Bharat')).toMatchObject([
      { code: 'duplicate_market', line: 6 },
    ]);
    expect(codes(one('## Markets\nIN | India\nLK | india'))).toEqual(['duplicate_market']);
    expect(codes(one('## Products\nA | a | b | IN | extra'))).toEqual(['bad_product_line']);
    expect(codes(one('## Products\n | generic'))).toEqual(['empty_name']);
    expect(codes(one('## Products\nA | | | IN, Lk'))).toEqual(['bad_country_code']);
    // A product is found by brand OR generic name, so a generic equal to another's brand is a clash.
    expect(one('## Products\nAlpha | beta\nBeta')).toMatchObject([
      { code: 'duplicate_product', line: 6 },
    ]);
    expect(codes(one('## Markets\n# only a note'))).toEqual(['nothing_to_load']);
  });

  it('notes are ignored; a product needs only its brand', () => {
    const { catalogue, problems } = checkCatalogue(CAT('# a note\n## Products\n# another\nSolo\n'));
    expect(problems).toEqual([]);
    expect(catalogue.products).toEqual([
      { brand: 'Solo', generic: '', area: '', markets: [], line: 7 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------

const reachable = await requireDatabase();

interface Person {
  email: string;
  userId: string;
  organisationId: string;
}
interface World {
  password: string;
  run: string;
  authorAdmin: Person;
  approverAdmin: Person;
  rep: Person;
}
let world: World;

const target = (who: Person) => ({
  url: API_URL,
  apiKey: ANON_KEY,
  email: who.email,
  password: world.password,
});
const readAs = async (who: Person, path: string): Promise<Record<string, unknown>[]> => {
  const { accessToken } = await signIn(who.email, world.password);
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`${path}: ${String(res.status)}`);
  return (await res.json()) as Record<string, unknown>[];
};
const catalogueOf = async (who: Person) => ({
  markets: (await readAs(who, 'markets?select=country_code,name')).length,
  products: (await readAs(who, 'products?select=brand_name')).length,
  links: (await readAs(who, 'product_markets?select=id')).length,
});

beforeAll(() => {
  if (!reachable) return;
  world = JSON.parse(
    execFileSync(
      'node',
      [fileURLToPath(new URL('../scripts/seed-practice-world.mjs', import.meta.url))],
      { encoding: 'utf8' },
    ),
  ) as World;
}, 180_000);

describe.skipIf(!reachable)('W2-I A3 — the catalogue, then what depends on it', () => {
  it('a course and approved material refused for want of a catalogue load once it is loaded', async () => {
    const courseText = sample('course-template.md')
      .replace('course: EXAMPLE — Storage and handling basics', `course: Storage ${world.run}`)
      .replace('market: any', 'market: India');
    const { course } = checkCourse(courseText);
    const { doc } = checkKnowledge(
      sample('knowledge-template.md')
        .replace(
          'title: EXAMPLE — Storage and handling (standard operating procedure)',
          `title: Benchmarol storage ${world.run}`,
        )
        .replace('type: sop', 'type: product_label')
        .replace('product:\n', 'product: Benchmarol\n')
        .replace('market: any', 'market: India'),
    );

    // THE SYMPTOM: a company with no catalogue — both refused.
    expect(await catalogueOf(world.authorAdmin)).toEqual({ markets: 0, products: 0, links: 0 });
    await expect(loadCourse(course, target(world.authorAdmin))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'unknown_market' })],
    });
    const refusal = (await loadKnowledge(doc, target(world.authorAdmin)).catch(
      (error: unknown) => error,
    )) as { problems?: { code: string }[] };
    expect(codes(refusal.problems ?? [])).toEqual(['unknown_market', 'unknown_product']);

    // The catalogue — the sample, renamed.
    const { catalogue, problems } = checkCatalogue(
      sample('catalogue-template.md').replace('catalogue: EXAMPLE — ', 'catalogue: '),
    );
    expect(problems).toEqual([]);
    expect(await loadCatalogue(catalogue, target(world.authorAdmin))).toEqual({
      marketsCreated: 1,
      marketsAlreadyHeld: 0,
      productsCreated: 1,
      productsAlreadyHeld: 0,
      therapyAreasCreated: 1,
      linksCreated: 1,
    });

    // Read back AS THE REP: the catalogue is the whole company's, and a rep reads it.
    expect(await readAs(world.rep, 'markets?select=country_code,name')).toEqual([
      { country_code: 'IN', name: 'India' },
    ]);
    expect(
      await readAs(
        world.rep,
        'products?select=brand_name,generic_name,therapy_areas(name),product_markets(markets(country_code))',
      ),
    ).toEqual([
      {
        brand_name: 'Benchmarol',
        generic_name: 'benchmarolum',
        therapy_areas: { name: 'Pain' },
        product_markets: [{ markets: { country_code: 'IN' } }],
      },
    ]);

    // THE PROOF: the same two files now load.
    expect(await loadCourse(course, target(world.authorAdmin))).toMatchObject({ lessons: 3 });
    expect(await loadKnowledge(doc, target(world.authorAdmin))).toMatchObject({ status: 'draft' });

    // Loading the catalogue again writes nothing and refuses nothing.
    expect(await loadCatalogue(catalogue, target(world.authorAdmin))).toEqual({
      marketsCreated: 0,
      marketsAlreadyHeld: 1,
      productsCreated: 0,
      productsAlreadyHeld: 1,
      therapyAreasCreated: 0,
      linksCreated: 0,
    });
    expect(await catalogueOf(world.authorAdmin)).toEqual({ markets: 1, products: 1, links: 1 });
  });

  it('REFUSED against what the company holds — and nothing at all is written', async () => {
    const before = await catalogueOf(world.authorAdmin);
    const refused = async (body: string, code: string) => {
      const { catalogue, problems } = checkCatalogue(CAT(`## Markets\nLK | Sri Lanka\n${body}`));
      expect(problems).toEqual([]);
      await expect(loadCatalogue(catalogue, target(world.authorAdmin))).rejects.toMatchObject({
        problems: [expect.objectContaining({ code })],
      });
    };
    await refused('IN | Bharat', 'market_differs');
    await refused('XX | India', 'market_differs');
    await refused('## Products\nBenchmarol | otherium', 'product_differs');
    await refused('## Products\nNovol | Benchmarol', 'name_clash');
    await refused('## Products\nNovol | | | BD', 'unknown_market');
    const { catalogue } = checkCatalogue(CAT('## Markets\nLK | Sri Lanka'));
    await expect(loadCatalogue(catalogue, target(world.rep))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'not_admin' })],
    });
    // Sri Lanka was valid in every one of those files; none of them wrote it.
    expect(await catalogueOf(world.authorAdmin)).toEqual(before);
  });

  it('a load that FAILS part-way is finished by running it again — nothing to clean up', async () => {
    const { catalogue } = checkCatalogue(
      CAT('## Markets\nNP | Nepal\n## Products\nHalfol | halfolum | | NP\nWholol | | | NP'),
    );
    const failing: typeof fetch = (input, init) =>
      init?.method === 'POST' && (input as string).endsWith('/rest/v1/products')
        ? Promise.resolve(new Response('{"message":"connection lost"}', { status: 503 }))
        : fetch(input, init);
    await expect(
      loadCatalogue(catalogue, { ...target(world.authorAdmin), fetchImpl: failing }),
    ).rejects.toThrow(/refused/u);
    expect(await readAs(world.authorAdmin, 'markets?select=name&country_code=eq.NP')).toHaveLength(
      1,
    );
    expect(await loadCatalogue(catalogue, target(world.authorAdmin))).toMatchObject({
      marketsCreated: 0,
      marketsAlreadyHeld: 1,
      productsCreated: 2,
      linksCreated: 2,
    });
  });
});

describe.skipIf(!reachable)(
  'W2-I A4 (`BE-W168`) — content day, end to end, with no hand-written call',
  () => {
    it('catalogue → course → PUBLISHED → a rep sees it; material → IN REVIEW → the console lists it → a second admin approves', async () => {
      const { catalogue } = checkCatalogue(
        sample('catalogue-template.md').replace('catalogue: EXAMPLE — ', 'catalogue: '),
      );
      await loadCatalogue(catalogue, target(world.authorAdmin));

      const courseTitle = `Content day ${world.run}`;
      const { course } = checkCourse(
        sample('course-template.md')
          .replace('course: EXAMPLE — Storage and handling basics', `course: ${courseTitle}`)
          .replace('market: any', 'market: India'),
      );
      const loaded = await loadCourse(course, target(world.authorAdmin));
      // A DRAFT is invisible to a rep…
      expect(
        await readAs(world.rep, `course_versions?select=id&id=eq.${loaded.versionId}`),
      ).toEqual([]);
      const published = await contentStep('publish-course', courseTitle, target(world.authorAdmin));
      expect(published).toEqual({
        versionId: loaded.versionId,
        versionNumber: 1,
        status: 'published',
      });
      // …and once published, the rep reads it.
      expect(
        await readAs(world.rep, `course_versions?select=status&id=eq.${loaded.versionId}`),
      ).toEqual([{ status: 'published' }]);

      const docTitle = `Benchmarol handling ${world.run}`;
      const { doc } = checkKnowledge(
        sample('knowledge-template.md')
          .replace(
            'title: EXAMPLE — Storage and handling (standard operating procedure)',
            `title: ${docTitle}`,
          )
          .replace('type: sop', 'type: product_label')
          .replace('product:\n', 'product: Benchmarol\n')
          .replace('market: any', 'market: India'),
      );
      const draft = await loadKnowledge(doc, target(world.authorAdmin));
      // The console's Knowledge approvals reads exactly this: in_review, nothing else.
      const consoleQuery = `knowledge_document_versions?select=id&status=eq.in_review&id=eq.${draft.versionId}`;
      expect(await readAs(world.approverAdmin, consoleQuery)).toEqual([]);
      expect(await contentStep('submit-knowledge', docTitle, target(world.authorAdmin))).toEqual({
        versionId: draft.versionId,
        versionNumber: 1,
        status: 'in_review',
      });
      expect(await readAs(world.approverAdmin, consoleQuery)).toEqual([{ id: draft.versionId }]);

      // The approval stays four eyes, in the console — here, the same RPC the console calls.
      const { accessToken } = await signIn(world.approverAdmin.email, world.password);
      const approve = await fetch(`${API_URL}/rest/v1/rpc/approve_knowledge_version`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_version_id: draft.versionId,
          p_attestation: 'W2-I A4: local test.',
        }),
      });
      expect(approve.status).toBe(200);
      expect(
        await readAs(
          world.rep,
          `knowledge_document_versions?select=status&id=eq.${draft.versionId}`,
        ),
      ).toEqual([{ status: 'approved' }]);
    });

    it('REFUSED, and nothing moves: no such title, no draft, not an admin', async () => {
      await expect(
        contentStep('publish-course', `Nothing ${world.run}`, target(world.authorAdmin)),
      ).rejects.toMatchObject({ code: 'not_found' });
      // The course above is published; it has no draft left to publish.
      await expect(
        contentStep('publish-course', `Content day ${world.run}`, target(world.authorAdmin)),
      ).rejects.toMatchObject({ code: 'no_draft' });
      await expect(
        contentStep('submit-knowledge', `Benchmarol handling ${world.run}`, target(world.rep)),
      ).rejects.toMatchObject({ code: 'not_admin' });
    });
  },
);
