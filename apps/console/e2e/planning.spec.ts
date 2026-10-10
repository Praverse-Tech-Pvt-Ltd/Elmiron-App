import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * `BE-W171` / `BE-C78` — manager planning through the console, against the real database.
 *
 * The manager plans a rep's day and re-saves it unchanged; a visit the rep made without a plan
 * appears as UNPLANNED with its reason and is marked reviewed; an admin is refused planning in words
 * and grants and revokes a manager's planning access. Every write is the screen's own click; the only
 * API calls are setup an admin or a rep would make anyway (a doctor, an unplanned visit).
 */

const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://127.0.0.1:54321';
const FUTURE = '2030-01-16';

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
let doctorName: string;

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

/** The one field of the first row a PostgREST answer carries, or a failure that says which. */
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

test.beforeAll(async () => {
  world = JSON.parse(
    execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
      encoding: 'utf8',
    }),
  ) as World;

  // A doctor in the rep's territory, made by the admin: master data, which a deployment has.
  const profile = await rest(
    world.authorAdmin,
    `user_profiles?id=eq.${world.rep.userId}&select=territory_id`,
  );
  const territoryId = await firstField(profile, 'territory_id');
  doctorName = `Dr Planning ${world.run}`;
  const made = await rest(world.authorAdmin, 'doctors', {
    method: 'POST',
    body: JSON.stringify({
      id: randomUUID(),
      organisation_id: world.authorAdmin.organisationId,
      full_name: doctorName,
      territory_id: territoryId,
    }),
  });
  expect(made.status).toBe(201);
});

test('a manager plans a rep’s day, and an unchanged re-save writes nothing', async ({ page }) => {
  await signIn(page, world.manager);
  await page.goto(`/planning?rep=${world.rep.userId}&date=${FUTURE}`);
  await expect(
    page.getByRole('heading', { name: `Route for ${FUTURE} — no plan yet` }),
  ).toBeVisible();

  await page.getByLabel('Doctor to add').selectOption({ label: doctorName });
  await page.getByRole('button', { name: 'Add to route' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText(/^Saved as version 1: 1 visit\(s\) added/u)).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: `Route for ${FUTURE} — version 1` }),
  ).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(doctorName, 'u') });
  await expect(row.getByText('Planned')).toBeVisible();
  await expect(row.getByText('Not started')).toBeVisible();

  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(
    page.getByText('No change — this is already the plan. Nothing new was written.'),
  ).toBeVisible();
});

test('a day that has ended cannot be edited', async ({ page }) => {
  await signIn(page, world.manager);
  await page.goto(`/planning?rep=${world.rep.userId}&date=2020-01-01`);
  await expect(
    page.getByText('This day has ended for the rep. Its plan is history and cannot be changed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeDisabled();
});

test('a rep’s own visit appears as UNPLANNED, with its reason, and the manager reviews it', async ({
  page,
}) => {
  const doctors = await rest(
    world.authorAdmin,
    `doctors?full_name=eq.${encodeURIComponent(doctorName)}&select=id`,
  );
  const doctorId = await firstField(doctors, 'id');
  const visit = await rest(world.rep, 'visits', {
    method: 'POST',
    body: JSON.stringify({
      id: randomUUID(),
      doctor_id: doctorId,
      origin: 'unplanned',
      unplanned_reason: 'Doctor called me in',
      scheduled_for: new Date().toISOString(),
    }),
  });
  expect(visit.status).toBe(201);
  expect(await firstField(visit, 'origin')).toBe('unplanned');

  await signIn(page, world.manager);
  // The rep's today, as the page reports it, is the day the visit is on.
  await page.goto(`/planning?rep=${world.rep.userId}`);
  const today = (await page.getByText(/’s today is \d{4}-\d{2}-\d{2}/u).textContent())?.match(
    /\d{4}-\d{2}-\d{2}/u,
  )?.[0];
  expect(today).toBeDefined();
  await page.goto(`/planning?rep=${world.rep.userId}&date=${String(today)}`);

  const row = page.getByRole('row', { name: /Reason: Doctor called me in/u });
  await expect(row.getByText('Unplanned')).toBeVisible();
  await row.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(row.getByText('Reviewed')).toBeVisible();
});

test('an admin is told planning is the manager’s, and grants then revokes planning access', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin);
  await page.goto('/planning');
  await expect(
    page.getByText(
      'Only a field manager plans a rep’s day. Admins grant planning access instead. Nothing was saved.',
    ),
  ).toBeVisible();

  await page.goto('/planning/access');
  await page.getByLabel('Field manager').selectOption({ value: world.manager.userId });
  await page.getByLabel('Why').fill(`Covering ${world.run}`);
  await page.getByRole('button', { name: 'Grant' }).click();
  await expect(page.getByText(/^Granted from /u)).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(`Covering ${world.run}`, 'u') });
  await expect(row.getByText('Active')).toBeVisible();
  await row.getByRole('textbox').fill('Colleague is back');
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row.getByText('Revoked')).toBeVisible();
});

test('a manager is shown their grants and offered no way to grant', async ({ page }) => {
  await signIn(page, world.manager);
  await page.goto('/planning/access');
  await expect(
    page.getByText('Only an admin grants planning access. Any grant made for you is listed below.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grant' })).toHaveCount(0);
});
