import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * `FE-W75`–`FE-W79` — the four admin screens through the console, against the real database and the
 * served `admin-accounts` Edge Function.
 *
 * An admin builds a National and a Region territory and sets the Region's hours; creates a field
 * manager on it through the screen, and that person SIGNS IN with the temporary password shown once
 * (which proves the account was made confirmed, with its profile); deactivates them and resets their
 * password; finds the creation in the audit log; and reads the retention screen. A manager is told,
 * in words, that users are an admin's and that the tree is read-only for them.
 */

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
}

let world: World;
let created: { email: string; password: string } | null = null;

const signIn = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

test.beforeAll(() => {
  world = JSON.parse(
    execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
      encoding: 'utf8',
    }),
  ) as World;
});

const code = (suffix: string): string => `E2E-${world.run.toUpperCase()}${suffix}`;

test('the four admin screens are in the sidebar, and nothing is "coming later"', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin.email, world.password);
  const nav = page.getByRole('navigation', { name: 'Console' });
  for (const label of ['Users & roles', 'Territories', 'Audit log', 'Retention & purge']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(nav.getByText('Coming later')).toHaveCount(0);
});

test('an admin builds a National and a Region, and sets the Region’s hours', async ({ page }) => {
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/territories');
  await page.getByLabel('Name of the new National').fill(`India ${world.run}`);
  await page.getByLabel('Code of the new National').fill(code(''));
  await page.getByRole('button', { name: 'Add National' }).click();

  const national = page.getByRole('row', { name: new RegExp(code(''), 'u') }).first();
  await national.getByRole('button', { name: 'Add beneath' }).click();
  await national.getByLabel('Name of the new Region').fill(`West ${world.run}`);
  await national.getByLabel('Code of the new Region').fill(code('-W'));
  await national.getByRole('button', { name: 'Add Region' }).click();

  const region = page.getByRole('row', { name: new RegExp(`${code('-W')} — West`, 'u') });
  await expect(region.getByText('Region')).toBeVisible();
  await region.getByRole('button', { name: 'Hours' }).click();
  await region.getByLabel(`Start of day in ${code('-W')}`).fill('08:30');
  await region.getByLabel(`End of day in ${code('-W')}`).fill('17:30');
  await region.getByRole('button', { name: 'Save hours' }).click();
  await expect(region.getByText('Its own hours')).toBeVisible();
  await expect(region.getByText(/08:30–17:30/u)).toBeVisible();
});

test('a code already used anywhere is refused in words', async ({ page }) => {
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/territories');
  await page.getByLabel('Name of the new National').fill('Again');
  await page.getByLabel('Code of the new National').fill(code(''));
  await page.getByRole('button', { name: 'Add National' }).click();
  await expect(page.getByText(/Codes are unique across the whole system/u).last()).toBeVisible();
});

test('an admin creates a field manager, who signs in with the password shown once', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/users');
  const email = `e2e-manager-${world.run}@example.test`;
  const card = page
    .locator('div', { has: page.getByRole('heading', { name: 'Add a user' }) })
    .last();
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Full name').fill(`E2E Manager ${world.run}`);
  await card.getByLabel('Role').selectOption('field_manager');
  await card
    .getByLabel('Territory')
    .selectOption({ label: `Region · ${code('-W')} — West ${world.run}` });
  await card.getByRole('button', { name: 'Create user' }).click();
  await expect(
    card.getByText(`Created E2E Manager ${world.run} (${email}) as Field manager.`),
  ).toBeVisible();
  const password = (await card.locator('code').textContent()) ?? '';
  expect(password).toMatch(/^[A-Za-z0-9]{16}$/u);
  created = { email, password };

  await page.context().clearCookies();
  await signIn(page, email, password);
  await page.goto('/territories');
  // Their own territory, read-only: the profile was made in the same flow, on the Region chosen.
  await expect(page.getByText(code('-W'), { exact: true })).toBeVisible();
  await expect(page.getByText('Add a National territory')).toHaveCount(0);
});

test('an admin deactivates them with a reason, then resets their password', async ({ page }) => {
  expect(created).not.toBeNull();
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/users');
  const row = page.getByRole('row', { name: new RegExp(`E2E Manager ${world.run}`, 'u') });
  await row.getByPlaceholder('Why (kept in the audit log)').fill('E2E: left the company');
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(
    row.getByText(/Deactivated: they can no longer read or change anything/u),
  ).toBeVisible();
  await row.getByPlaceholder('Why (kept in the audit log)').fill('E2E: old password must stop');
  await row.getByRole('button', { name: 'Reset password' }).click();
  await expect(row.getByText('Password reset. The old password no longer works.')).toBeVisible();
  await expect(row.locator('code')).toHaveText(/^[A-Za-z0-9]{16}$/u);
});

test('the audit log finds the creation, filtered to user changes', async ({ page }) => {
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/audit?table=user_profiles&action=insert');
  await expect(
    page.getByRole('cell', {
      name: `created e2e-manager-${world.run}@example.test as field_manager`,
    }),
  ).toBeVisible();
});

test('the retention screen says what is kept and how the worker stands', async ({ page }) => {
  await signIn(page, world.authorAdmin.email, world.password);
  await page.goto('/retention');
  await expect(page.getByRole('heading', { name: 'What is kept, and for how long' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The retention worker' })).toBeVisible();
  await expect(page.getByText(/days from when the server received them/u)).toBeVisible();
});

test('a manager is told users are an admin’s, and sees no territory controls', async ({ page }) => {
  await signIn(page, world.manager.email, world.password);
  await page.goto('/users');
  await expect(
    page.getByText(
      'Only an active admin manages users. Nothing here is hidden from you by mistake.',
    ),
  ).toBeVisible();
  await page.goto('/territories');
  await expect(
    page.getByText(
      'You can see your own territory and everything beneath it. Only an admin changes them.',
    ),
  ).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByText(/Only an admin reads the audit log/u)).toBeVisible();
});
