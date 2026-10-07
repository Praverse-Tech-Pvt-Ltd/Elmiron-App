import { expect, type Page } from '@playwright/test';
import type { GatewayFeature } from '@fieldforce/core';

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
  feature: GatewayFeature,
  text: string,
  limits: { readonly temperature: string; readonly maxTokens: string } = {
    temperature: '0',
    maxTokens: '800',
  },
): Promise<void> => {
  await author.goto('/prompts');
  await author.getByLabel('Which feature this prompt is for').selectOption(feature);
  await author.getByLabel('The instructions the model is given').fill(text);
  // W2-E A3: required. Without them the version would run on limits nobody approved.
  await author.getByLabel('Temperature, from 0 to 1').fill(limits.temperature);
  await author.getByLabel('Longest answer, in tokens').fill(limits.maxTokens);
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
