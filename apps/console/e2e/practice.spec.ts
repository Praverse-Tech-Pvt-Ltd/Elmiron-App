import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * W1-F B5/B6 — the authoring screens, driven by a real browser.
 *
 * **What this adds over the tests that already exist.** The render tests prove a click calls
 * `onCreate` with the right values. An HTTP script proves those values are accepted by the server.
 * **Neither runs the client bundle in a browser**, and the one defect this screen actually shipped
 * with — a pure function in a `'use client'` module, which is a client *reference* on the server —
 * was invisible to both: it needed somebody to REQUEST the page. This file is that somebody.
 *
 * **Nothing here touches a real doctor, a real recording or patient data.** Every identifier is
 * minted by `seed-practice-world.mjs` into a throwaway organisation, on localhost, and the spec
 * asserts that below rather than promising it.
 *
 * **The proof is two-sided and the two sides are the same scenario.** `start_sim_session` is called
 * for one scenario id before and after a second admin approves it in the browser, and the two
 * answers must differ. Everything before that last step is a form.
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
  readonly rep: Person;
  readonly otherOrgAdmin: Person;
}

let world: World;
let personaName: string;
let scenarioTitle: string;

test.beforeAll(() => {
  const output = execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
    encoding: 'utf8',
  });
  world = JSON.parse(output) as World;
  // Names minted by THIS run. An earlier version of this proof asserted on the example name in the
  // form's own caution text, so the cross-tenant check was matching static copy and would have
  // passed against an empty database. A value only this run could have produced is the only kind
  // worth asserting on.
  personaName = `Dr Practice ${world.run} (practice)`;
  scenarioTitle = `First call ${world.run}`;
});

const signIn = async (page: Page, person: Person): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

/** The rep's call, as the field app would make it: a real token, never the service-role key. */
const startSimSession = async (scenarioId: string): Promise<{ status: number; body: unknown }> => {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: world.rep.email, password: world.password }),
  });
  const session = (await auth.json()) as { access_token: string };
  const res = await fetch(`${API}/rest/v1/rpc/start_sim_session`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_scenario_id: scenarioId }),
  });
  return { status: res.status, body: await res.json() };
};

const cardFor = (page: Page, title: string) =>
  page.locator('section', { has: page.getByText(title, { exact: true }) });

// ---------------------------------------------------------------------------

test('a practice session becomes startable only after a second admin approves it', async ({
  browser,
}) => {
  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();

  // --- the author drafts a persona -----------------------------------------

  await signIn(author, world.authorAdmin);
  await author.goto('/practice');
  await expect(author.getByRole('heading', { name: 'New practice doctor' })).toBeVisible();

  await author.getByLabel('Name shown to the rep').fill(personaName);
  await author.getByLabel('Specialty').fill('Urology');
  await author.getByLabel('How they behave').selectOption('sceptical');
  await author.getByLabel('Brief').fill('Busy clinic. Wants evidence, not enthusiasm.');
  await author.getByRole('button', { name: 'Save draft' }).first().click();

  const personaCard = cardFor(author, personaName);
  await expect(personaCard).toBeVisible();
  // Born a draft. The form never offered a status, and the database would have refused one.
  await expect(personaCard.getByText('draft', { exact: true })).toBeVisible();

  // --- four eyes, seen rather than asserted about ---------------------------

  await personaCard.getByRole('button', { name: 'Submit for review' }).click();
  await expect(personaCard.getByText('in_review', { exact: true })).toBeVisible();

  await expect(
    personaCard.getByText('You drafted this version, so you cannot approve it', { exact: false }),
  ).toBeVisible();
  await expect(personaCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(personaCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);

  // --- the second admin approves the persona --------------------------------

  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await signIn(approver, world.approverAdmin);
  await approver.goto('/practice');

  const approverPersonaCard = cardFor(approver, personaName);
  const approveButton = approverPersonaCard.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeVisible();
  // Disabled until something is written. The attestation is stored, and it is not optional.
  await expect(approveButton).toBeDisabled();
  await approverPersonaCard
    .getByLabel('Your attestation')
    .fill('Read in full. Names no real doctor and makes no product claim.');
  await approveButton.click();
  await expect(approverPersonaCard.getByText('approved', { exact: true })).toBeVisible();

  // --- the author drafts a scenario against the approved persona ------------

  await author.reload();
  await author.getByLabel('Title').fill(scenarioTitle);
  await author.getByLabel('What the rep should achieve').fill('Get agreement to a follow-up.');
  await author
    .getByLabel('The objection the doctor will raise')
    .fill('I have prescribed the same thing for ten years.');
  await author
    .locator('section', { has: author.getByRole('heading', { name: 'New practice scenario' }) })
    .getByRole('button', { name: 'Save draft' })
    .click();

  const scenarioCard = cardFor(author, scenarioTitle);
  await expect(scenarioCard).toBeVisible();
  await scenarioCard.getByRole('button', { name: 'Submit for review' }).click();
  await expect(scenarioCard.getByText('in_review', { exact: true })).toBeVisible();

  // --- BEFORE: the rep cannot start it --------------------------------------

  // The id the rep will use, read back through the APPROVER's own signed-in session in the page --
  // so it comes from a row RLS was willing to show that person, not from the seeder.
  const ids = await approver.evaluate(
    async ([api, anon, title]) => {
      const raw = document.cookie
        .split('; ')
        .find((c) => c.startsWith('sb-127-auth-token='))
        ?.slice('sb-127-auth-token='.length);
      const json = JSON.parse(atob((raw ?? '').replace('base64-', ''))) as {
        access_token: string;
      };
      const res = await fetch(
        `${api}/rest/v1/sim_scenarios?select=id,title&title=eq.${encodeURIComponent(title)}`,
        { headers: { apikey: anon, authorization: `Bearer ${json.access_token}` } },
      );
      return (await res.json()) as { id: string }[];
    },
    [API, ANON, scenarioTitle] as const,
  );
  // Exactly one, asserted before it is read: two rows would mean an earlier run leaked into this
  // one, and picking the first of them would make everything after this meaningless.
  const [onlyScenario] = ids;
  expect(ids).toHaveLength(1);
  if (onlyScenario === undefined) throw new Error('no scenario row came back');
  const theScenario = onlyScenario.id;

  const before = await startSimSession(theScenario);
  expect(before.status).toBe(400);
  expect(JSON.stringify(before.body)).toContain('not approved');

  // --- the second admin approves the scenario -------------------------------

  await approver.reload();
  const approverScenarioCard = cardFor(approver, scenarioTitle);
  await approverScenarioCard
    .getByLabel('Your attestation')
    .fill('Objective and objection are training content. No product claim.');
  await approverScenarioCard.getByRole('button', { name: 'Approve' }).click();
  await expect(approverScenarioCard.getByText('approved', { exact: true })).toBeVisible();

  // --- AFTER: the same scenario id, the opposite answer ---------------------

  const after = await startSimSession(theScenario);
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({ personaDisplayName: personaName });

  await authorContext.close();
  await approverContext.close();
});

test('B6 — an admin of another organisation is served nothing of ours', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, world.otherOrgAdmin);
  await page.goto('/practice');

  // The page renders for them -- this is a tenancy check, not an authorisation one.
  await expect(page.getByRole('heading', { name: 'New practice doctor' })).toBeVisible();
  await expect(page.getByText(personaName, { exact: true })).toHaveCount(0);
  await expect(page.getByText(scenarioTitle, { exact: true })).toHaveCount(0);

  await context.close();
});

test('nothing on this screen offers a real doctor, a recording or patient data', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin);
  await page.goto('/practice');
  // `main`, not `body`: the sidebar carries a "Consent versions" link on every page, and a check
  // that fails because of the nav would be a check about the shell rather than this screen.
  const text = ((await page.locator('main').textContent()) ?? '').toLowerCase();
  for (const forbidden of ['patient', 'recording', 'audio', 'consent']) {
    expect(text, `the word "${forbidden}" must not appear on this screen`).not.toContain(forbidden);
  }
});
