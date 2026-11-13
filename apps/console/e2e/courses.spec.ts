import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * LMS admin flow — publishing a loaded course version from the console (`/courses`), which only
 * `content-step.mjs publish-course` could do. Its own seeded world, so the draft it publishes is not
 * the one `learning.spec.ts` relies on staying unpublished.
 */

interface Person {
  readonly email: string;
}
interface World {
  readonly password: string;
  readonly run: string;
  readonly authorAdmin: Person;
  readonly manager: Person;
  readonly draftCourse: { readonly title: string };
  readonly publishedCourse: { readonly title: string };
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

test('an admin publishes a loaded draft, and it reads as published', async ({ page }) => {
  await signIn(page, world.authorAdmin);
  await page.goto('/courses');
  const row = page.getByRole('row', { name: new RegExp(world.draftCourse.title, 'u') });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Publish' }).click();
  await expect(row.getByText('Published', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Retire' })).toBeVisible();
});

// `FE-W164`: a manager is no longer offered a Retire button to press into the refusal. The page says
// once that publishing is an admin's; `retire_course_version` still refuses a manager whatever is
// drawn (the API suite holds that).
test('a manager is told publishing is an admin’s, and is offered no button', async ({ page }) => {
  await signIn(page, world.manager);
  await page.goto('/courses');
  await expect(page.getByText(/^Only an admin publishes or retires a course\./u)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(world.publishedCourse.title, 'u') });
  await expect(row.getByText('Published', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Retire' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
});
