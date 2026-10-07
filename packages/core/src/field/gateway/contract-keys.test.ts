import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SimCoachOutputSchema, SimDoctorTurnOutputSchema } from '../simulation.js';
import { LMS_TUTOR_OUTPUT_CONTRACT, LmsTutorOutputSchema } from './lms-tutor.js';
import { MR_CHAT_OUTPUT_CONTRACT, MrChatOutputSchema } from './mr-chat.js';
import { PRODUCT_QA_OUTPUT_CONTRACT, ProductQaOutputSchema } from './product-qa.js';
import { GATEWAY_FEATURES } from './prompt-contract.js';
import type { GatewayFeature } from './prompt-contract.js';
import { SIM_COACH_OUTPUT_CONTRACT, SIM_DOCTOR_OUTPUT_CONTRACT } from './sim-doctor.js';

/**
 * W2-E B4 (`BE-W163`) — does every flow TELL the model every key its output is validated against?
 *
 * The coach's contract named none of its keys while the other four named theirs, and it survived
 * because nobody compared them. This compares them: enumerated from `GATEWAY_FEATURES` (the flows),
 * every key of each flow's output schema — nested objects and array elements included — must appear,
 * in double quotes, in the fixed contract that flow appends to the approved prompt. A key the model
 * is never told is a key it will name differently, and the answer then fails `schema_invalid`.
 *
 * Keyed on `GatewayFeature`, so a sixth flow does not typecheck here until somebody pairs it.
 */
const CONTRACTS: Readonly<Record<GatewayFeature, { contract: string; schema: z.ZodType }>> = {
  product_qa: { contract: PRODUCT_QA_OUTPUT_CONTRACT, schema: ProductQaOutputSchema },
  mr_chat: { contract: MR_CHAT_OUTPUT_CONTRACT, schema: MrChatOutputSchema },
  lms_tutor: { contract: LMS_TUTOR_OUTPUT_CONTRACT, schema: LmsTutorOutputSchema },
  ai_doctor: { contract: SIM_DOCTOR_OUTPUT_CONTRACT, schema: SimDoctorTurnOutputSchema },
  ai_coach: { contract: SIM_COACH_OUTPUT_CONTRACT, schema: SimCoachOutputSchema },
};

/** Every object key reachable in a schema, through arrays and optional/nullable wrappers. */
const keysOf = (schema: z.ZodType): string[] => {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, child]) => [
      key,
      ...keysOf(child),
    ]);
  }
  if (schema instanceof z.ZodArray) return keysOf(schema.element as z.ZodType);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return keysOf(schema.unwrap() as z.ZodType);
  }
  return [];
};

describe('every flow names every key it validates (BE-W163 sweep)', () => {
  it.each(GATEWAY_FEATURES)('%s', (feature) => {
    const { contract, schema } = CONTRACTS[feature];
    const keys = keysOf(schema);
    expect(keys.length).toBeGreaterThan(0);
    const unnamed = keys.filter((k) => !contract.includes(`"${k}"`));
    expect(unnamed, `keys the ${feature} contract never names`).toEqual([]);
  });

  it('the walk reaches nested keys — it is not only reading the top level', () => {
    expect(keysOf(SimCoachOutputSchema)).toEqual(
      expect.arrayContaining(['dimensionScores', 'closing', 'turnIndex', 'moduleId', 'reason']),
    );
  });
});
