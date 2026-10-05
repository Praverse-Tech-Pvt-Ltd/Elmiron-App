import { expect, type Page } from '@playwright/test';

/**
 * W1-G E1 — create and approve an `ai_doctor` prompt **through the screen**, as two admins.
 *
 * **Why this is a helper and not three SQL statements in the seeder.** It used to be exactly that:
 * `seed-practice-world.mjs` wrote an approved prompt directly, because `ai_prompt_versions` had no
 * console route. `BE-W122` built one, so the fixture now walks the operator's path — which means
 * the path in the checklist and the path the tests take cannot drift apart. If `/prompts` breaks,
 * the practice suite breaks, and that is true of the product too.
 *
 * Both admins are required: the table's four-eyes CHECK refuses a decision by the author.
 */
export const approvePromptThroughTheScreen = async (
  author: Page,
  approver: Page,
  feature: 'ai_doctor' | 'ai_coach' | 'product_qa',
  text: string,
): Promise<void> => {
  await author.goto('/prompts');
  await author.getByLabel('Which feature this prompt is for').selectOption(feature);
  await author.getByLabel('The instructions the model is given').fill(text);
  await author.getByRole('button', { name: 'Save draft' }).click();

  const card = (page: Page) =>
    page.locator('section', {
      has: page.getByRole('heading', { name: `${feature} — version 1` }),
    });

  await expect(card(author)).toBeVisible();
  await card(author).getByRole('button', { name: 'Submit for review' }).click();
  await expect(card(author).getByText('in_review', { exact: true })).toBeVisible();

  await approver.goto('/prompts');
  await card(approver)
    .getByLabel('Your attestation')
    .fill('Placeholder prompt for a local test. No product claim.');
  await card(approver).getByRole('button', { name: 'Approve' }).click();
  await expect(card(approver).getByText('approved', { exact: true })).toBeVisible();
};
