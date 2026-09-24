import { z } from 'zod';
import { UuidSchema } from '../../shared/primitives.js';
import { AiBeginRequestResponseSchema } from '../ai.js';
import type { AiRequestFlag } from '../ai.js';
import {
  KNOWLEDGE_NOT_AVAILABLE_MESSAGE,
  SearchApprovedKnowledgeResponseSchema,
} from '../knowledge.js';
import type { KnowledgeSearchResult } from '../knowledge.js';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE, detectPatientSignals } from './guardrails.js';
import { ProviderTimeoutError, generateStructured, withTimeout } from './providers.js';
import type { ControlPlaneRpc, LlmProvider, LlmResult } from './providers.js';

/**
 * `product_qa` — the first AI feature, end to end, with no vendor and no runtime in it.
 *
 * The master prompt §5/§9: an MR asks about a product; the answer comes only from approved
 * knowledge for their market, with citations, or it is "Approved information not available".
 *
 * **The order of the steps is the design:**
 *
 * 1. `ai_begin_request` — the database decides whether this feature may run at all (flag,
 *    approved prompt, limit) and hands back the approved prompt. A refusal is thrown with its
 *    SQLSTATE (45011/45012) for `refusalForSqlState`.
 * 2. **Guardrails, before anything leaves the building.** A question carrying a patient
 *    identifier or asking for patient-specific advice is refused here: no search, no model, no
 *    storage. The request is closed as `blocked` with a flag and no text.
 * 3. `search_approved_knowledge`, scoped to the MR's organisation, market and product.
 * 4. **Nothing approved matched → the model is never called.** A model with no sources can only
 *    invent; there is no prompt wording that makes that safe.
 * 5. The model, given only the approved chunks, must return JSON naming the chunks it used.
 * 6. **Every citation must be a chunk it was given.** An answer citing anything else, or
 *    nothing, or failing the schema, is discarded and the MR gets the not-available sentence.
 *    Failing closed means the worst outcome of a bad model reply is an unhelpful answer, never an
 *    unsupported claim.
 * 7. `ai_complete_request` records what happened: tokens, the knowledge versions actually cited,
 *    and flags. Never the question or the answer.
 */

/** The output the model must produce. Named here, and required by name on the approved prompt. */
export const ProductQaOutputSchema = z.object({
  /** False when the sources do not answer the question. The model is told to say so. */
  supported: z.boolean(),
  answer: z.string(),
  citedChunkIds: z.array(UuidSchema),
});
export type ProductQaOutput = z.infer<typeof ProductQaOutputSchema>;
export const PRODUCT_QA_OUTPUT_SCHEMA_NAME = 'ProductQaOutputSchema';

export interface ProductQaCitation {
  readonly chunkId: string;
  readonly documentTitle: string;
  readonly documentVersionId: string;
  readonly versionNumber: number;
  readonly heading: string | null;
  readonly sourceReference: string;
}

export type ProductQaResult =
  | {
      readonly kind: 'answered';
      readonly requestId: string;
      readonly answer: string;
      readonly citations: readonly ProductQaCitation[];
    }
  | { readonly kind: 'not_available'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'patient_specific'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'failed'; readonly requestId: string; readonly message: string };

export interface ProductQaInput {
  readonly rpc: ControlPlaneRpc;
  readonly provider: LlmProvider;
  readonly question: string;
  readonly marketId: string | null;
  readonly productId: string | null;
  /** Default 20 seconds. */
  readonly timeoutMs?: number;
  /** Default 5, the most the model is shown. */
  readonly maxSources?: number;
}

export const PRODUCT_QA_FAILED_MESSAGE =
  'The assistant could not answer just now. Please try again, or refer the question to the ' +
  'Medical/Scientific team.';

/**
 * The fixed half of the system message. The approved prompt version is the organisation's
 * voice; this is the contract with the code, and is not editable per organisation because the
 * code below depends on it.
 */
const OUTPUT_CONTRACT = [
  'Answer ONLY from the numbered sources below. Do not use any other knowledge.',
  'If the sources do not answer the question, set "supported" to false and leave "answer" empty.',
  'Never give advice about an individual patient.',
  'Reply with JSON only: {"supported": boolean, "answer": string, "citedChunkIds": string[]}.',
  '"citedChunkIds" must list the id of every source you used, copied exactly.',
].join('\n');

const renderSources = (sources: readonly KnowledgeSearchResult[]): string =>
  sources
    .map(
      (s, i) =>
        `[${String(i + 1)}] id=${s.chunkId}\n` +
        `Document: ${s.documentTitle} (version ${String(s.versionNumber)})` +
        (s.heading === null ? '' : `, section: ${s.heading}`) +
        `\n${s.body}`,
    )
    .join('\n\n');

export const answerProductQuestion = async (input: ProductQaInput): Promise<ProductQaResult> => {
  const { rpc, provider } = input;
  const question = input.question.trim();
  if (question.length === 0) throw new Error('answerProductQuestion: empty question');

  // 1. May this run at all? Refusals propagate with their SQLSTATE.
  const begun = AiBeginRequestResponseSchema.parse(
    await rpc.call('ai_begin_request', { p_feature: 'product_qa' }),
  );
  const requestId = begun.requestId;

  const complete = async (args: {
    status: 'completed' | 'failed' | 'blocked';
    raw?: LlmResult;
    knowledgeVersionIds?: readonly string[];
    flags?: readonly AiRequestFlag[];
    errorCode?: string;
  }): Promise<void> => {
    await rpc.call('ai_complete_request', {
      p_request_id: requestId,
      p_status: args.status,
      p_model_provider: args.raw?.provider ?? null,
      p_model_name: args.raw?.model ?? null,
      p_input_tokens: args.raw?.usage.inputTokens ?? null,
      p_output_tokens: args.raw?.usage.outputTokens ?? null,
      p_knowledge_version_ids: args.knowledgeVersionIds ?? [],
      p_flags: args.flags ?? [],
      p_error_code: args.errorCode ?? null,
    });
  };

  // The approved prompt must be the one this code was written for. A prompt approved for another
  // output shape would make every reply fail validation -- refuse loudly instead.
  if (begun.outputSchemaName !== PRODUCT_QA_OUTPUT_SCHEMA_NAME) {
    await complete({ status: 'failed', errorCode: 'prompt_schema_mismatch' });
    return { kind: 'failed', requestId, message: PRODUCT_QA_FAILED_MESSAGE };
  }

  // 2. Guardrails, before search, model or storage.
  const signals = detectPatientSignals(question);
  if (signals.length > 0) {
    const onlyAdvice = signals.every((s) => s === 'patient_specific_advice');
    await complete({
      status: 'blocked',
      flags: onlyAdvice ? ['guardrail_triggered'] : ['patient_identifier_detected'],
    });
    return { kind: 'patient_specific', requestId, message: PATIENT_SPECIFIC_REFUSAL_MESSAGE };
  }

  // 3. Approved knowledge only.
  const search = SearchApprovedKnowledgeResponseSchema.parse(
    await rpc.call('search_approved_knowledge', {
      p_query: question,
      p_market_id: input.marketId,
      p_product_id: input.productId,
      p_limit: input.maxSources ?? 5,
    }),
  );

  // 4. Nothing approved: the model is never asked.
  if (search.status === 'not_available') {
    await complete({ status: 'completed', flags: ['knowledge_not_available'] });
    return { kind: 'not_available', requestId, message: KNOWLEDGE_NOT_AVAILABLE_MESSAGE };
  }
  const sources = search.results;

  // 5. The model, with only the sources.
  let structured;
  try {
    structured = await withTimeout(input.timeoutMs ?? 20_000, (signal) =>
      generateStructured(provider, ProductQaOutputSchema, {
        messages: [
          { role: 'system', content: `${begun.systemPrompt}\n\n${OUTPUT_CONTRACT}` },
          {
            role: 'user',
            content: `Sources:\n\n${renderSources(sources)}\n\nQuestion: ${question}`,
          },
        ],
        modelConfig: begun.modelConfig,
        signal,
      }),
    );
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError;
    await complete({
      status: 'failed',
      flags: [timedOut ? 'provider_timeout' : 'provider_error'],
      errorCode: timedOut ? 'provider_timeout' : 'provider_error',
    });
    return { kind: 'failed', requestId, message: PRODUCT_QA_FAILED_MESSAGE };
  }

  // 6. Validate the reply against what the model was actually given.
  const byChunk = new Map(sources.map((s) => [s.chunkId, s]));
  if (!structured.ok) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: structured.reason,
    });
    return { kind: 'not_available', requestId, message: KNOWLEDGE_NOT_AVAILABLE_MESSAGE };
  }
  const out = structured.value;
  const cited = [...new Set(out.citedChunkIds)];
  const citationsValid = cited.length > 0 && cited.every((id) => byChunk.has(id));

  if (!out.supported) {
    await complete({
      status: 'completed',
      raw: structured.raw,
      flags: ['knowledge_not_available'],
    });
    return { kind: 'not_available', requestId, message: KNOWLEDGE_NOT_AVAILABLE_MESSAGE };
  }
  if (!citationsValid || out.answer.trim().length === 0) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['guardrail_triggered'],
      errorCode: 'unsupported_citation',
    });
    return { kind: 'not_available', requestId, message: KNOWLEDGE_NOT_AVAILABLE_MESSAGE };
  }

  // 7. Record which approved versions the answer rests on.
  const citations = cited.map((id) => {
    const s = byChunk.get(id) as KnowledgeSearchResult;
    return {
      chunkId: s.chunkId,
      documentTitle: s.documentTitle,
      documentVersionId: s.documentVersionId,
      versionNumber: s.versionNumber,
      heading: s.heading,
      sourceReference: s.sourceReference,
    };
  });
  await complete({
    status: 'completed',
    raw: structured.raw,
    knowledgeVersionIds: [...new Set(citations.map((c) => c.documentVersionId))],
  });
  return { kind: 'answered', requestId, answer: out.answer.trim(), citations };
};
