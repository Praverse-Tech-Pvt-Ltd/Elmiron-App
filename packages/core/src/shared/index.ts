/**
 * `@elmiron/core/shared` — everything a second app can consume unchanged.
 *
 * Identity, primitives, the error envelope, pagination and configuration. Nothing
 * here mentions a doctor, a visit or a consent record. If the patient app ever
 * splits this package, this is the half it takes.
 */

export * from './primitives.js';
export * from './identity.js';
export * from './errors.js';
export * from './pagination.js';
export * from './config.js';
