import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireDatabase } from './db.js';
import { ANON_KEY, API_URL, signIn } from './auth.js';
import { checkCourse, loadCourse } from '../scripts/load-course.mjs';
import { checkKnowledge, loadKnowledge } from '../scripts/load-knowledge.mjs';

/**
 * W2-H A — the two content loaders. The checks run anywhere; the loads run against the local stack,
 * as a throwaway company's own admin (`seed-practice-world.mjs`), through PostgREST — the same
 * refusals the console meets — and are read back as the role that would use the result.
 */
const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/operator/${name}`, import.meta.url), 'utf8');
const codes = (problems: { code: string }[]): string[] => problems.map((p) => p.code);

const COURSE = (body: string, header = 'course: Real course\nmarket: any') =>
  `---\n${header}\n---\n${body}`;

describe('W2-H A1 — the course file is checked, every problem by line, before anything', () => {
  it('the SAMPLE is refused by name, and for nothing else — it is otherwise a valid course', () => {
    const { problems } = checkCourse(sample('course-template.md'));
    expect(codes(problems)).toEqual(['example_content']);
    const real = checkCourse(
      sample('course-template.md').replace('course: EXAMPLE — ', 'course: '),
    );
    expect(real.problems).toEqual([]);
    expect(
      real.course.modules.map((m) => [m.title, m.lessons.map((l) => [l.title, l.minutes])]),
    ).toEqual([
      [
        'Keeping stock in good condition',
        [
          ['Why storage matters', 4],
          ['Temperature on the road', 5],
        ],
      ],
      ['Handing samples over', [['Recording what you hand over', 3]]],
    ]);
  });

  it('each refusal, by its code', () => {
    expect(codes(checkCourse('no header').problems)).toEqual(['missing_header']);
    expect(codes(checkCourse('---\ncourse: X\n## M\n### L\ntext').problems)).toEqual([
      'missing_header',
    ]);
    expect(codes(checkCourse(COURSE('## M\n### L\ntext', 'course: X')).problems)).toEqual([
      'missing_field',
    ]);
    expect(codes(checkCourse(COURSE('## M\n### L\ntext', 'market: any')).problems)).toEqual([
      'missing_field',
    ]);
    expect(
      codes(checkCourse(COURSE('## M\n### L\ntext', 'course X\ncourse: Y\nmarket: any')).problems),
    ).toEqual(['bad_header_line']);
    expect(codes(checkCourse(COURSE('Intro.\n## M\n### L\ntext')).problems)).toEqual([
      'stray_text',
    ]);
    expect(codes(checkCourse(COURSE('### L\ntext\n## M\n### L2\ntext')).problems)).toEqual([
      'lesson_before_module',
    ]);
    expect(codes(checkCourse(COURSE('## M\n###  \ntext')).problems)).toEqual(['empty_title']);
    expect(codes(checkCourse(COURSE('## M\n## N\n### L\ntext')).problems)).toEqual([
      'module_without_lessons',
    ]);
    expect(codes(checkCourse(COURSE('')).problems)).toEqual(['no_modules']);
    expect(codes(checkCourse(COURSE('## M\n### L\n\n')).problems)).toEqual(['empty_lesson']);
    expect(codes(checkCourse(COURSE('## M\n### L\nminutes: 2.5\ntext')).problems)).toEqual([
      'bad_minutes',
    ]);
    expect(codes(checkCourse(COURSE('## M\n### L\nminutes: 0\ntext')).problems)).toEqual([
      'bad_minutes',
    ]);
    expect(codes(checkCourse(COURSE('## M\n### L\ntext\n### l\nmore')).problems)).toEqual([
      'duplicate_lesson',
    ]);
  });

  it('every problem at once, each with its line', () => {
    const { problems } = checkCourse(
      COURSE('Intro.\n## M\n### L\nminutes: x\n', 'course: EXAMPLE x\nmarket: any'),
    );
    expect(problems.map((p) => [p.code, p.line])).toEqual([
      ['example_content', 2],
      ['stray_text', 5],
      ['bad_minutes', 8],
      ['empty_lesson', 7],
    ]);
  });

  it('"minutes:" is read only right after the lesson title; later it is lesson text', () => {
    const { course, problems } = checkCourse(COURSE('## M\n### L\nFirst line.\nminutes: 9\n'));
    expect(problems).toEqual([]);
    expect(course.modules[0]?.lessons[0]).toMatchObject({
      minutes: null,
      body: 'First line.\nminutes: 9',
    });
  });
});

const DOC = (header: string, body = '## S\nApproved text.') => `---\n${header}\n---\n${body}`;
const DOC_OK = 'title: Real doc\ntype: sop\nmarket: any\nsource: SOP 1\neffective: 2026-10-01';

describe('W2-H A2 — the approved-material file is checked the same way', () => {
  it('the SAMPLE is refused by name, and for nothing else', () => {
    expect(codes(checkKnowledge(sample('knowledge-template.md')).problems)).toEqual([
      'example_content',
    ]);
    expect(
      checkKnowledge(sample('knowledge-template.md').replace('title: EXAMPLE — ', 'title: '))
        .problems,
    ).toEqual([]);
  });

  it('each refusal, by its code', () => {
    expect(codes(checkKnowledge(DOC(DOC_OK)).problems)).toEqual([]);
    expect(codes(checkKnowledge(DOC(DOC_OK.replace('source: SOP 1', ''))).problems)).toEqual([
      'missing_field',
    ]);
    expect(
      codes(checkKnowledge(DOC(DOC_OK.replace('type: sop', 'type: brochure'))).problems),
    ).toEqual(['unknown_type']);
    expect(codes(checkKnowledge(DOC(DOC_OK.replace('2026-10-01', '2026-02-30'))).problems)).toEqual(
      ['bad_date'],
    );
    expect(codes(checkKnowledge(DOC(`${DOC_OK}\nreview: 2026-09-01`)).problems)).toEqual([
      'review_before_effective',
    ]);
    expect(codes(checkKnowledge(DOC(`${DOC_OK}\nproduct: Benchmarol`)).problems)).toEqual([
      'product_needs_market',
    ]);
    expect(codes(checkKnowledge(DOC(DOC_OK, '   ')).problems)).toEqual(['empty_body']);
    expect(codes(checkKnowledge(DOC(DOC_OK.replace('Real doc', 'EXAMPLE doc'))).problems)).toEqual([
      'example_content',
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
const restAs = async (who: Person) => {
  const { accessToken } = await signIn(who.email, world.password);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path}: ${JSON.stringify(parsed)}`);
    return parsed as Record<string, unknown>[];
  };
  return { call, token: accessToken };
};

beforeAll(async () => {
  if (!reachable) return;
  world = JSON.parse(
    execFileSync(
      'node',
      [fileURLToPath(new URL('../scripts/seed-practice-world.mjs', import.meta.url))],
      { encoding: 'utf8' },
    ),
  ) as World;
  // What an admin's company would hold before loading content: a market and a product.
  const admin = await restAs(world.authorAdmin);
  await admin.call('POST', 'markets', { country_code: 'IN', name: 'India' });
  await admin.call('POST', 'products', { brand_name: 'Benchmarol', generic_name: 'benchmarolum' });
}, 180_000);

describe.skipIf(!reachable)('W2-H A4 — loaded, then read back as the role that uses it', () => {
  it('COURSE: a draft as the admin; refused again while open; published; taken by the rep', async () => {
    const text = sample('course-template.md')
      .replace(
        'course: EXAMPLE — Storage and handling basics',
        `course: Storage and handling ${world.run}`,
      )
      .replace('market: any', 'market: India');
    const { course, problems } = checkCourse(text);
    expect(problems).toEqual([]);
    const out = await loadCourse(course, target(world.authorAdmin));
    expect(out).toMatchObject({ versionNumber: 1, modules: 2, lessons: 3 });

    // As the admin: a DRAFT, for India, its lessons in the file's order.
    const admin = await restAs(world.authorAdmin);
    const [version] = await admin.call(
      'GET',
      `course_versions?select=status,market_id,markets(name)&id=eq.${out.versionId}`,
    );
    expect(version).toMatchObject({ status: 'draft', markets: { name: 'India' } });
    const lessons = await admin.call(
      'GET',
      `lessons?select=title,position,estimated_minutes,course_modules(title,position)&course_version_id=eq.${out.versionId}`,
    );
    expect(
      lessons
        .map((l) => [
          (l['course_modules'] as { position: number }).position,
          l['position'],
          l['title'],
          l['estimated_minutes'],
        ])
        .sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1])),
    ).toEqual([
      [1, 1, 'Why storage matters', 4],
      [1, 2, 'Temperature on the road', 5],
      [2, 1, 'Recording what you hand over', 3],
    ]);

    // Loading the same course again while its draft is open: refused, nothing written.
    await expect(loadCourse(course, target(world.authorAdmin))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'draft_already_open' })],
    });
    expect(
      await admin.call('GET', `course_versions?select=id&course_id=eq.${out.courseId}`),
    ).toHaveLength(1);

    // A rep cannot see a draft at all.
    const repBefore = await restAs(world.rep);
    expect(await repBefore.call('GET', `course_versions?select=id&id=eq.${out.versionId}`)).toEqual(
      [],
    );

    // The admin publishes and assigns — the loader never does either.
    await admin.call('POST', 'rpc/publish_course_version', { p_course_version_id: out.versionId });
    await admin.call('POST', 'rpc/assign_course', {
      p_course_id: out.courseId,
      p_assignee_user_id: world.rep.userId,
    });

    // The rep, through the APP's own learning backend: assigned, startable, the lessons in order.
    const live = (await import(
      fileURLToPath(new URL('../../../apps/field/src/learning/live.ts', import.meta.url))
    )) as {
      createLiveLearningBackend: (c: unknown) => {
        myCourses(): Promise<{ assignments: { courseId: string }[] }>;
        start(v: string): Promise<{ id: string }>;
        outline(v: string, e: string): Promise<unknown>;
      };
    };
    // Grouped the way the rep's screen groups it: modules in order, each module's lessons in order.
    const view = (await import(
      fileURLToPath(new URL('../../../apps/field/src/learning/view.ts', import.meta.url))
    )) as {
      outlineSections: (rows: unknown) => {
        sections: { title: string; lessons: { title: string }[] }[];
      };
    };
    const rep = await restAs(world.rep);
    const backend = live.createLiveLearningBackend({
      baseUrl: API_URL,
      apiKey: ANON_KEY,
      accessToken: () => Promise.resolve(rep.token),
    });
    expect((await backend.myCourses()).assignments.map((a) => a.courseId)).toContain(out.courseId);
    const enrolment = await backend.start(out.versionId);
    const { sections } = view.outlineSections(await backend.outline(out.versionId, enrolment.id));
    expect(sections.map((s) => [s.title, s.lessons.map((l) => l.title)])).toEqual([
      ['Keeping stock in good condition', ['Why storage matters', 'Temperature on the road']],
      ['Handing samples over', ['Recording what you hand over']],
    ]);
  });

  it('KNOWLEDGE: a DRAFT only — the approver sees a draft — and the existing four-eyes path takes it from there', async () => {
    const text = sample('knowledge-template.md')
      .replace(
        'title: EXAMPLE — Storage and handling (standard operating procedure)',
        `title: Storage and handling ${world.run}`,
      )
      .replace('type: sop', 'type: product_label')
      .replace('product:\n', 'product: Benchmarol\n')
      .replace('market: any', 'market: India');
    const { doc, problems } = checkKnowledge(text);
    expect(problems).toEqual([]);
    const out = await loadKnowledge(doc, target(world.authorAdmin));
    expect(out.status).toBe('draft');

    // As the APPROVER (a different admin): a draft, about Benchmarol, for India, with no chunks yet.
    const approver = await restAs(world.approverAdmin);
    const [version] = await approver.call(
      'GET',
      `knowledge_document_versions?select=status,source_reference,markets(name),knowledge_documents(title,document_type,products(brand_name))&id=eq.${out.versionId}`,
    );
    expect(version).toMatchObject({
      status: 'draft',
      source_reference: 'Company SOP QA-07, version 2, sections 3 and 4',
      markets: { name: 'India' },
      knowledge_documents: {
        document_type: 'product_label',
        products: { brand_name: 'Benchmarol' },
      },
    });
    expect(
      await approver.call(
        'GET',
        `knowledge_chunks?select=id&document_version_id=eq.${out.versionId}`,
      ),
    ).toEqual([]);

    // The author submits, the approver approves — the existing path, untouched by the loader.
    const author = await restAs(world.authorAdmin);
    await author.call('POST', 'rpc/submit_knowledge_version', { p_version_id: out.versionId });
    await approver.call('POST', 'rpc/approve_knowledge_version', {
      p_version_id: out.versionId,
      p_attestation: 'W2-H A4: read in full. Local test.',
    });
    const chunks = await approver.call(
      'GET',
      `knowledge_chunks?select=heading&document_version_id=eq.${out.versionId}&order=position`,
    );
    expect(chunks.map((c) => c['heading'])).toEqual([
      'Receiving stock at the depot',
      'Carrying samples',
      'Each "##" heading starts a section',
    ]);
  });

  it('REFUSED before anything is written: a rep, an unknown market — no row appears', async () => {
    const admin = await restAs(world.authorAdmin);
    const before = (await admin.call('GET', 'courses?select=id')).length;
    const { course } = checkCourse(
      COURSE('## M\n### L\ntext', `course: Refused ${world.run}\nmarket: any`),
    );
    await expect(loadCourse(course, target(world.rep))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'not_admin' })],
    });
    const { course: nowhere } = checkCourse(
      COURSE('## M\n### L\ntext', `course: Refused ${world.run}\nmarket: Atlantis`),
    );
    await expect(loadCourse(nowhere, target(world.authorAdmin))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'unknown_market' })],
    });
    const { doc } = checkKnowledge(
      DOC(
        DOC_OK.replace('market: any', 'market: India').replace('Real doc', `Refused ${world.run}`) +
          '\nproduct: Nothingol',
      ),
    );
    await expect(loadKnowledge(doc, target(world.authorAdmin))).rejects.toMatchObject({
      problems: [expect.objectContaining({ code: 'unknown_product' })],
    });
    expect((await admin.call('GET', 'courses?select=id')).length).toBe(before);
    expect(
      await admin.call('GET', `knowledge_documents?select=id&title=eq.Refused ${world.run}`),
    ).toEqual([]);
  });
});
