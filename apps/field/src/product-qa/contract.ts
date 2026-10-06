/**
 * W2-C C / `BE-W160` — Product Q&A, as the screen speaks it.
 *
 * The server is `ai-gateway` with `feature: 'product_qa'`, which answers ONLY from approved
 * knowledge and cites it (`packages/core/src/field/gateway/product-qa.ts`, `BE-C37`). With no approved
 * knowledge loaded it answers `not_available` to every question — the state a pilot company starts
 * in, and so the first real screen rather than a placeholder.
 */
export const PRODUCT_QA_FEATURE = 'product_qa';

/** What the screen sends: the feature and the rep's own question. Nothing else. */
export interface ProductQaRequestBody {
  readonly feature: typeof PRODUCT_QA_FEATURE;
  readonly question: string;
}

/** A source the answer was drawn from, as the gateway returns it. */
export interface ProductQaSource {
  readonly documentTitle: string;
  readonly versionNumber: number;
  readonly heading: string | null;
  readonly sourceReference: string;
}

/** Built from what the rep typed and nothing else: a string in, so no context can ride along. */
export const productQaRequestBody = (typed: string): ProductQaRequestBody | null => {
  const question = typed.trim();
  return question.length === 0 ? null : { feature: PRODUCT_QA_FEATURE, question };
};
