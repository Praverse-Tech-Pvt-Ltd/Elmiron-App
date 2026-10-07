import { z } from 'zod';
import type { AiFeature } from '../ai.js';
import { SIM_COACH_OUTPUT_SCHEMA_NAME, SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME } from '../simulation.js';
import { LMS_TUTOR_OUTPUT_SCHEMA_NAME } from './lms-tutor.js';
import { MR_CHAT_OUTPUT_SCHEMA_NAME } from './mr-chat.js';
import { PRODUCT_QA_OUTPUT_SCHEMA_NAME } from './product-qa.js';

/**
 * W2-E A (`BE-W164`) — what a prompt row must carry for the gateway to run it, in one place.
 *
 * **The defect this exists for.** Every flow refuses an approved prompt whose `output_schema_name`
 * is not its own constant (`prompt_schema_mismatch`), and the console's `/prompts` screen saved
 * only `feature` and `system_prompt`. So a prompt approved through the documented four-eyes screen
 * could never run, and the only way to make it run was SQL — the step that screen was built to
 * remove. Nothing saw it because the console's browser test stopped at "approved" and the
 * gateway's tests used prompts no console made.
 *
 * **The schema name is derived from the feature, never typed.** Each feature has exactly one
 * output shape; a field for it would be a place to type the wrong one.
 */

/** The features with a gateway path behind them. The console offers exactly these. */
export const GATEWAY_FEATURES = [
  'product_qa',
  'mr_chat',
  'lms_tutor',
  'ai_doctor',
  'ai_coach',
] as const satisfies readonly AiFeature[];
export type GatewayFeature = (typeof GATEWAY_FEATURES)[number];

/** The output schema each flow checks the approved prompt against — the flows' own constants. */
export const GATEWAY_OUTPUT_SCHEMA_NAME: Readonly<Record<GatewayFeature, string>> = {
  product_qa: PRODUCT_QA_OUTPUT_SCHEMA_NAME,
  mr_chat: MR_CHAT_OUTPUT_SCHEMA_NAME,
  lms_tutor: LMS_TUTOR_OUTPUT_SCHEMA_NAME,
  ai_doctor: SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME,
  ai_coach: SIM_COACH_OUTPUT_SCHEMA_NAME,
};

/**
 * Which model answers each feature (`BE-C41`: Sonnet for reasoning-heavy work, Haiku for `mr_chat`
 * and `lms_tutor`). **Code, not a prompt setting:** the gateway maps the tier to an India inference
 * profile and the adapter refuses any other, so a model picked on a screen would make data
 * residency a form field. Read here so the screen can SAY which model, from the same map the
 * gateway uses.
 */
export const GATEWAY_MODEL: Readonly<Record<GatewayFeature, 'sonnet' | 'haiku'>> = {
  product_qa: 'sonnet',
  ai_doctor: 'sonnet',
  ai_coach: 'sonnet',
  mr_chat: 'haiku',
  lms_tutor: 'haiku',
};

export const GATEWAY_MODEL_LABEL: Readonly<Record<'sonnet' | 'haiku', string>> = {
  sonnet: 'Claude Sonnet 5, India profile',
  haiku: 'Claude Haiku 4.5, India profile',
};

/**
 * The limits a prompt version carries. These two keys are the only ones the Bedrock adapter reads
 * (`bedrock-provider.ts`, `inferenceConfig`). Both are REQUIRED on the screen: a version without
 * them would run on the vendor's defaults, which nobody approved. The bounds are a product cap,
 * not the vendor's limit — 8192 is four times the longest draft proposal (the coach's 2000).
 */
export const PromptModelConfigSchema = z
  .object({
    temperature: z.number().min(0).max(1),
    maxTokens: z.number().int().min(1).max(8192),
  })
  .strict();
export type PromptModelConfig = z.infer<typeof PromptModelConfigSchema>;

/** The insert the console sends for a new draft. The only place its columns are chosen. */
export const promptDraftRow = (input: {
  readonly feature: GatewayFeature;
  readonly systemPrompt: string;
  readonly modelConfig: PromptModelConfig;
}): {
  feature: GatewayFeature;
  system_prompt: string;
  output_schema_name: string;
  model_config: PromptModelConfig;
} => ({
  feature: input.feature,
  system_prompt: input.systemPrompt,
  output_schema_name: GATEWAY_OUTPUT_SCHEMA_NAME[input.feature],
  model_config: PromptModelConfigSchema.parse(input.modelConfig),
});
