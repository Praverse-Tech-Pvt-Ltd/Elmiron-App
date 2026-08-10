/**
 * @elmiron/core — interface contract I1.
 *
 * Single source of truth for entity shapes, API request/response shapes and the
 * typed client. Frontend, the manager console and the AI/ML pipeline all build
 * against this package. Breaking changes are announced in writing before they land
 * (see `docs/mr-work-split.md` §4).
 */

export * from './primitives.js';

export * from './entities/identity.js';
export * from './entities/field.js';
export * from './entities/consent.js';
export * from './entities/capture.js';
export * from './entities/analysis.js';
export * from './entities/sync.js';

export * from './api/errors.js';
export * from './api/pagination.js';
export * from './api/endpoints.js';

export * from './client.js';
