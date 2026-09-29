import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * W1-G E1 / `BE-W122` — the prompt screen, proven the same way `/practice` was.
 *
 * **The claim under test is not "a form works". It is that the SEED IS NO LONGER NECESSARY.**
 * `seed-practice-world.mjs` writes an approved `ai_doctor` prompt with three raw SQL statements,
 * because until this screen existed there was no other way to get one. This spec creates and
 * approves a prompt entirely through the browser, by two different admins, and then asserts the
 * row is approved — which is the whole of what the seed's SQL was for.
 *
 * The world it signs in as is seeded WITHOUT relying on that prompt for anything here.
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
  readonly rep: Person;
}

let world: World;

test.beforeAll(() => {
  const output = execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
    encoding: 'utf8',
  });
  world = JSON.parse(output) as World;
});

const signIn = async (page: Page, person: Person): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

const cardFor = (page: Page, heading: string) =>
  page.locator('section', { has: page.getByRole('heading', { name: heading }) });

test('a prompt can be written and approved without anybody touching SQL', async ({ browser }) => {
  const promptText = `PLACEHOLDER for run ${world.run}. You are a doctor in a practice conversation. Stay in character.`;

  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();
  await signIn(author, world.authorAdmin);
  await author.goto('/prompts');

  await expect(author.getByRole('heading', { name: 'New prompt' })).toBeVisible();
  await author.getByLabel('Which feature this prompt is for').selectOption('ai_doctor');
  await author.getByLabel('The instructions the model is given').fill(promptText);
  await author.getByRole('button', { name: 'Save draft' }).click();

  // Version 1: the seeder no longer writes one. The number comes from the insert trigger's max+1,
  // computed by the database and never by this form.
  const card = cardFor(author, 'ai_doctor — version 1');
  await expect(card).toBeVisible();
  await expect(card.getByText('draft', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Submit for review' }).click();
  await expect(card.getByText('in_review', { exact: true })).toBeVisible();

  // Four eyes, the same imported rule for the third time.
  await expect(
    card.getByText('You drafted this version, so you cannot approve it', { exact: false }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await signIn(approver, world.approverAdmin);
  await approver.goto('/prompts');

  const approverCard = cardFor(approver, 'ai_doctor — version 1');
  const approve = approverCard.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  await approverCard
    .getByLabel('Your attestation')
    .fill('Read in full. No product claim, no indication, no prescribing information.');
  await approve.click();

  await expect(approverCard.getByText('approved', { exact: true })).toBeVisible();

  await authorContext.close();
  await approverContext.close();
});

test('the prompt box refuses to be a place where regulated content is invented', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin);
  await page.goto('/prompts');
  // Not enforcement — nothing can detect a product claim in free text. It is the one place a
  // person is told, before they type, that this box is not where a claim may come from.
  await expect(page.getByText('must not contain a product claim', { exact: false })).toBeVisible();
});
