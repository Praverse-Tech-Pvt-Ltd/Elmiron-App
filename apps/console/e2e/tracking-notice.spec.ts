import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * `FE-W91` / `BE-W201` — the company's own live location notice, loaded by one admin and approved by
 * another, entirely through the console.
 *
 * Before this screen the only way to put a company's notice in force was two RPC calls by hand. The
 * world is fresh per run (`seed-practice-world.mjs`), so its company starts on the engineering draft.
 * The author is told to wait for a second admin and is offered no Approve button; the second admin
 * approves with what they checked; the version is then in force, and the page says every rep must
 * accept again. A label used twice and a field manager are both refused in words.
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
  readonly approverAdmin: Person;
  readonly manager: Person;
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

const versionCard = (page: Page, label: string) =>
  page.locator('section', { has: page.getByRole('heading', { name: label, exact: true }) });

test('one admin loads the notice, a second approves it, and it is in force', async ({
  browser,
}) => {
  const label = `E2E notice ${world.run}`;
  const text =
    `Location sharing during working hours - notice for run ${world.run}. ` +
    'Your position is shared about every 5 minutes, only during working hours.';

  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();
  await signIn(author, world.authorAdmin);

  // Reached from the sidebar and from the live location page.
  const nav = author.getByRole('navigation', { name: 'Console' });
  await expect(nav.getByRole('link', { name: 'Live location notice' })).toBeVisible();
  await author.goto('/tracking');
  await author.getByRole('link', { name: /load and approve your company’s own/u }).click();
  await author.waitForURL(/\/tracking\/notice/u);

  await expect(author.getByText('Engineering draft — not approved')).toBeVisible();
  await expect(author.getByText(/every rep must read and accept it again/u).first()).toBeVisible();

  const load = author.getByRole('button', { name: 'Load this version' });
  await expect(load).toBeDisabled();
  await author.getByLabel('Version label').fill(label);
  await author.getByLabel('Notice text').fill(text);
  await load.click();
  await expect(
    author.getByText(/It is not shown to anybody until a second admin approves it/u),
  ).toBeVisible();

  const mine = versionCard(author, label);
  await expect(mine.getByText('Waiting for a second admin', { exact: true })).toBeVisible();
  await expect(mine.getByText(/You loaded this version, so you cannot approve it/u)).toBeVisible();
  await expect(mine.getByRole('button', { name: /Approve/u })).toHaveCount(0);
  // Loading changed nothing reps see.
  await expect(author.getByText('Engineering draft — not approved')).toBeVisible();

  // The same label again is refused in words.
  await author.getByLabel('Version label').fill(label);
  await author.getByLabel('Notice text').fill(text);
  await author.getByRole('button', { name: 'Load this version' }).click();
  await expect(author.getByText(/already has a version with this label/u)).toBeVisible();

  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await signIn(approver, world.approverAdmin);
  await approver.goto('/tracking/notice');
  const theirs = versionCard(approver, label);
  const approve = theirs.getByRole('button', { name: `Approve ${label}` });
  await expect(approve).toBeDisabled();
  await theirs.getByLabel(`What you checked in ${label}`).fill('E2E: read in full');
  await approve.click();
  await expect(theirs.getByText(/is now in force; every rep must accept it again/u)).toBeVisible();

  await approver.reload();
  await expect(approver.getByRole('heading', { name: `In force now: ${label}` })).toBeVisible();
  await expect(approver.getByText('Your company’s, approved')).toBeVisible();
  await expect(versionCard(approver, label).getByText('In force', { exact: true })).toBeVisible();

  await authorContext.close();
  await approverContext.close();
});

test('a field manager is told the notice is an admin’s, not shown an empty list', async ({
  page,
}) => {
  await signIn(page, world.manager);
  await page.goto('/tracking/notice');
  await expect(
    page.getByText(/Only an admin loads or approves the live location notice/u),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load this version' })).toHaveCount(0);
});
