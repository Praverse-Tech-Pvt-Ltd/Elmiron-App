/**
 * The AI gateway's logic — runtime- and vendor-neutral (AI-D1).
 *
 * Whichever runtime D1 picks wraps these functions with a `ControlPlaneRpc` (the caller's token)
 * and an `LlmProvider` (the vendor D2 picks). Nothing here chooses either.
 */
export * from './providers.js';
export * from './guardrails.js';
export * from './product-qa.js';
export * from './benchmarks.js';
