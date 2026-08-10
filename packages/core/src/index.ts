/**
 * @elmiron/core — interface contract I1.
 *
 * Single source of truth for entity shapes, API request/response shapes and the
 * typed client. Frontend, the manager console and the AI/ML pipeline all build
 * against this package. Breaking changes are announced in writing before they land
 * (see `docs/mr-work-split.md` §4).
 *
 * The package is split into two namespaces:
 *
 *   `@elmiron/core/shared` — identity, primitives, errors, pagination, config.
 *                            A second app consumes these unchanged.
 *   `@elmiron/core/field`  — the MR domain: doctors, visits, capture, consent,
 *                            analysis, sync.
 *
 * This root entry re-exports both, so no consumer has to change. Import from the
 * subpaths in new code; the boundary is what makes a future split cheap.
 */

export * from './shared/index.js';
export * from './field/index.js';
