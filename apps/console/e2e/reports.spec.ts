import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * `FE-W205` — call report approval through the console, against the real database.
 *
 * The rep sends reports the way the phone does (`sync_push`, entity `call_report`); the manager
 * approves one from its row, two together through the bulk call, and records one as not approved
 * with a reason from its own page. Every decision is the screen's own click, and each list update
 * is waited for WITHOUT a reload: the list is refreshed from the server after a write
 * (`router.refresh()`), and that refresh is what this proves (`FE-W160`).
 *
 * The reports carry `status: 'submitted'`. The phone's own body has no status, and
 * `apply_sync_item` files a report without one as a DRAFT, which `approvable_call_reports` never
 * lists — so this spec sends the status the approval queue needs, and says so here rather than
 * passing quietly against a path the phone does not take.
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
  readonly manager: Person;
  readonly rep: Person;
}

let world: World;
let doctorId: string;

const tokenFor = async (person: Person): Promise<string> => {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: person.email, password: world.password }),
  });
  return ((await auth.json()) as { access_token: string }).access_token;
};

const rest = async (
  person: Person,
  path: string,
  init: { readonly method?: string; readonly body?: string } = {},
): Promise<Response> =>
  fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${await tokenFor(person)}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
  });

const firstField = async (response: Response, key: string): Promise<string> => {
  const rows = (await response.json()) as Record<string, unknown>[];
  const value = rows[0]?.[key];
  if (typeof value !== 'string') throw new Error(`no ${key} in ${JSON.stringify(rows)}`);
  return value;
};

const signIn = async (page: Page, person: Person): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

/**
 * One visit the rep made, and its report, sent through `sync_push` as the phone sends it (plus its
 * status). A visit has one report (`call_reports_one_per_visit_version`), so each report gets its
 * own visit.
 */
const sendReport = async (summary: string): Promise<string> => {
  const visitId = randomUUID();
  const visit = await rest(world.rep, 'visits', {
    method: 'POST',
    body: JSON.stringify({
      id: visitId,
      doctor_id: doctorId,
      origin: 'unplanned',
      unplanned_reason: 'Doctor asked to see me',
      scheduled_for: new Date().toISOString(),
    }),
  });
  expect(visit.status).toBe(201);
  const id = randomUUID();
  const response = await rest(world.rep, 'rpc/sync_push', {
    method: 'POST',
    body: JSON.stringify({
      p_batch_id: randomUUID(),
      p_items: [
        {
          id: randomUUID(),
          entity: 'call_report',
          operation: 'create',
          entityId: visitId,
          clientCreatedAt: new Date().toISOString(),
          payload: {
            id,
            visitId,
            summary,
            productIdsDiscussed: [],
            objectionsRaised: null,
            nextStep: 'Visit again next week',
            status: 'submitted',
          },
        },
      ],
    }),
  });
  const body = (await response.json()) as { results: { status: string }[] };
  expect(body.results[0]?.status, JSON.stringify(body)).toBe('accepted');
  return id;
};

test.beforeAll(async () => {
  world = JSON.parse(
    execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
      encoding: 'utf8',
    }),
  ) as World;

  // A doctor in the rep's territory: master data, made by the admin.
  const profile = await rest(
    world.authorAdmin,
    `user_profiles?id=eq.${world.rep.userId}&select=territory_id`,
  );
  const territoryId = await firstField(profile, 'territory_id');
  doctorId = randomUUID();
  const made = await rest(world.authorAdmin, 'doctors', {
    method: 'POST',
    body: JSON.stringify({
      id: doctorId,
      organisation_id: world.authorAdmin.organisationId,
      full_name: `Dr Reports ${world.run}`,
      territory_id: territoryId,
    }),
  });
  expect(made.status).toBe(201);
});

test('a manager approves one report, then two together, and the list updates without a reload', async ({
  page,
}) => {
  const one = `First report ${world.run}`;
  const two = `Second report ${world.run}`;
  const three = `Third report ${world.run}`;
  await sendReport(one);
  await sendReport(two);
  await sendReport(three);

  await signIn(page, world.manager);
  await page.goto('/reports');
  const row = (summary: string) => page.getByRole('row', { name: new RegExp(summary, 'u') });
  await expect(row(one)).toBeVisible();

  await row(one).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/^Approved the report from /u)).toBeVisible();
  await expect(row(one)).toHaveCount(0);

  await row(two).getByRole('checkbox').check();
  await row(three).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve 2 reports' }).click();
  await expect(page.getByText('Approved 2 reports.')).toBeVisible();
  await expect(row(two)).toHaveCount(0);
  await expect(row(three)).toHaveCount(0);
});

test('a manager reads a report in full and records it as not approved, with a reason', async ({
  page,
}) => {
  const summary = `Report to send back ${world.run}`;
  const id = await sendReport(summary);

  await signIn(page, world.manager);
  await page.goto(`/reports/${id}`);
  await expect(page.getByText(summary)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Do not approve' })).toBeDisabled();
  await page.getByLabel('Why it is not approved').fill('The products discussed are missing');
  await page.getByRole('button', { name: 'Do not approve' }).click();
  await expect(page.getByText(/^Not approved by .* on /u)).toBeVisible();
  await expect(page.getByText('Reason given: The products discussed are missing')).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByRole('row', { name: new RegExp(summary, 'u') })).toHaveCount(0);
});
