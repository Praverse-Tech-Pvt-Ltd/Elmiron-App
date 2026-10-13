/**
 * FE-D7 3 — is Android's "Remove animations" on?
 *
 * The hook now lives in `@fieldforce/ui` (`motion.ts`, FE-W101), because the shared components
 * animate too — a toast arriving, a sheet rising, content settling — and must obey the same
 * setting the stack transition does. Re-exported here so the app's existing import keeps working;
 * the behaviour, and its comment, moved with it unchanged.
 */
export { useReduceMotion } from '@fieldforce/ui';
