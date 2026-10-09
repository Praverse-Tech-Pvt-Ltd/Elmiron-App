import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * `BE-W168` — submitting a knowledge draft from the console, which only
 * `services/api/scripts/content-step.mjs` could do.
 *
 * **The refusals matter more than the happy path.** `submit_knowledge_version` accepts any admin of
 * the organisation and refuses everyone else with `42501` (`knowledge.spec.ts`, "only an admin of
 * the organisation manages knowledge"). This spec shows the SCREEN agrees with that: the author is
 * offered Submit, another admin is told why not, a manager and a rep are shown no draft at all and
 * the server refuses their call, and a refusal reaching the author's click is shown, not swallowed.
 *
 * There is no screen to write a draft, so each test drafts one through the API as the admin — the
 * same insert `load-knowledge.mjs` makes. The insert trigger forces `draft`.
 */

const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://127.0.0.1:54321';

interface Person {
  readonly email: string;
  readonly userId: string;
  readonly organisationId: string;
}
interface World {
  readonly password: string;
  readonly run: string;
  readonly authorAdmin: Person;
  readonly approverAdmin: Person;
  readonly manager: Person;
  readonly rep: Person;
}

let world: World;

test.beforeAll(() => {
  world = JSON.parse(
    execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
      encoding: 'utf8',
    }),
  ) as World;
});

const signIn = async (page: Page, person: Person): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

const tokenFor = async (person: Person): Promise<string> => {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: person.email, password: world.password }),
  });
  return ((await auth.json()) as { access_token: string }).access_token;
};

const as = async (person: Person) => ({
  apikey: ANON,
  authorization: `Bearer ${await tokenFor(person)}`,
  'content-type': 'application/json',
  prefer: 'return=representation',
});

/** The one row a write or read returned, or a failure that says which was missing. */
const only = <T>(rows: readonly T[], what: string): T => {
  const [row] = rows;
  if (row === undefined) throw new Error(`no ${what} came back`);
  return row;
};

/** A document and its draft version, written as `admin`. Returns the version id. */
const draftAs = async (admin: Person, title: string): Promise<string> => {
  const headers = await as(admin);
  const doc = await fetch(`${API}/rest/v1/knowledge_documents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, document_type: 'faq' }),
  });
  expect(doc.status, await doc.clone().text()).toBe(201);
  const documentId = only((await doc.json()) as { id: string }[], 'document').id;
  const version = await fetch(`${API}/rest/v1/knowledge_document_versions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      document_id: documentId,
      organisation_id: admin.organisationId,
      created_by_user_id: admin.userId,
      body: `PLACEHOLDER for run ${world.run}.\nStore below 25 degrees.`,
      source_reference: 'Browser test, not material',
      effective_from: '2026-10-01',
    }),
  });
  expect(version.status, await version.clone().text()).toBe(201);
  return only((await version.json()) as { id: string }[], 'draft version').id;
};

/** Read as the author, who as an admin sees every status. */
const rowOf = async (versionId: string) => {
  const res = await fetch(
    `${API}/rest/v1/knowledge_document_versions?select=status,submitted_by_user_id&id=eq.${versionId}`,
    { headers: await as(world.authorAdmin) },
  );
  return only(
    (await res.json()) as { status: string; submitted_by_user_id: string | null }[],
    'version row',
  );
};

const submitAs = (person: Person, versionId: string) =>
  as(person).then((headers) =>
    fetch(`${API}/rest/v1/rpc/submit_knowledge_version`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_version_id: versionId }),
    }),
  );

const cardFor = (page: Page, heading: string) =>
  page.locator('section', { has: page.getByRole('heading', { name: heading }) });

test('the author submits a draft from the screen, and then cannot approve it', async ({ page }) => {
  const title = `Storage FAQ, author path, ${world.run}`;
  const versionId = await draftAs(world.authorAdmin, title);

  await signIn(page, world.authorAdmin);
  await page.goto('/knowledge');
  const card = cardFor(page, title);
  await expect(card.getByText('Draft', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Submit for review' }).click();

  // The refreshed page draws this version in the review list; its four-eyes note is what tells the
  // author what happens next.
  await expect(card.getByText('In review', { exact: true })).toBeVisible();
  await expect(
    card.getByText('You drafted this version, so you cannot approve it', { exact: false }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  expect(await rowOf(versionId)).toEqual({
    status: 'in_review',
    submitted_by_user_id: world.authorAdmin.userId,
  });
});

test('an admin who did not write the draft is not offered Submit, and is told why', async ({
  page,
}) => {
  const title = `Storage FAQ, second admin, ${world.run}`;
  const versionId = await draftAs(world.authorAdmin, title);

  await signIn(page, world.approverAdmin);
  await page.goto('/knowledge');
  const card = cardFor(page, title);
  await expect(card.getByText('Draft', { exact: true })).toBeVisible();
  await expect(
    card.getByText('Only the admin who drafted this version submits it.', { exact: false }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  expect((await rowOf(versionId)).status).toBe('draft');
});

test('a manager and a rep see no draft, and the server refuses their submit', async ({
  browser,
}) => {
  const title = `Storage FAQ, refused roles, ${world.run}`;
  const versionId = await draftAs(world.authorAdmin, title);

  for (const person of [world.manager, world.rep]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, person);
    await page.goto('/knowledge');
    await expect(
      page.getByRole('heading', { name: 'Knowledge awaiting your approval' }),
    ).toBeVisible();
    // RLS, not this page: a non-admin reads only `approved` versions.
    await expect(cardFor(page, title)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
    await context.close();

    // The screen drawing nothing proves nothing on its own. The server is the control.
    const refused = await submitAs(person, versionId);
    expect(refused.ok, person.email).toBe(false);
    expect(((await refused.json()) as { code: string }).code, person.email).toBe('42501');
  }

  expect((await rowOf(versionId)).status).toBe('draft');
});

test('a refusal reaching the author’s click is shown, not swallowed', async ({ page }) => {
  const title = `Storage FAQ, stale page, ${world.run}`;
  const versionId = await draftAs(world.authorAdmin, title);

  await signIn(page, world.authorAdmin);
  await page.goto('/knowledge');
  const card = cardFor(page, title);
  await expect(card.getByRole('button', { name: 'Submit for review' })).toBeVisible();

  // Submitted elsewhere — `content-step.mjs`, or a second tab — after this page was drawn.
  expect((await submitAs(world.authorAdmin, versionId)).ok).toBe(true);

  await card.getByRole('button', { name: 'Submit for review' }).click();
  await expect(card.getByText(/is already in_review/)).toBeVisible();
  expect(await rowOf(versionId)).toEqual({
    status: 'in_review',
    submitted_by_user_id: world.authorAdmin.userId,
  });
});
