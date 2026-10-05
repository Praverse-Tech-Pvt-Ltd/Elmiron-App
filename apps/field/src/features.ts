/**
 * Build-time feature flags. Each is OFF unless the build sets it to exactly `true`.
 *
 * Read through `process.env.EXPO_PUBLIC_*` with DOT access, as `config.ts` explains: Expo inlines
 * that exact syntax at build time, and bracket access yields `undefined` in a release bundle.
 */

/**
 * FE-D4 1 — Coaching (the tab, the analysis screen, the reply screen).
 *
 * **Off by default, and off for the demo.** FE-D3 A3 found that these screens show mock AI output
 * that nothing real produces — the fixture names a model and the screen says "Written by the
 * system from the transcript" — so a rep, or anyone watching, could take it for working AI. Off:
 * the tab is not in the bar and all three routes send a deep link to Today. On: exactly as before.
 * Nothing behind it is deleted.
 *
 * Turn it on (`EXPO_PUBLIC_COACHING_ENABLED=true`) only when the content is real, or is visibly
 * labelled as sample content.
 */
export const coachingEnabled: boolean = process.env.EXPO_PUBLIC_COACHING_ENABLED === 'true';

/**
 * FE-D15 — the assistant, on SAMPLE data.
 *
 * **Off by default, and off for the demo.** On, Me gains an "Assistant" row and `app/assistant.tsx`
 * opens, but every reply comes from the sample fixture in `src/assistant/sample.ts`. No request
 * leaves the phone, and the screen and every reply say "sample data". Off, the row does not exist
 * and a deep link goes to Today.
 *
 * It becomes the real assistant only after FE-CR-7 lands the chat contract in `packages/core`.
 * That is a later change, and it replaces `src/assistant/transport.ts` rather than this flag's
 * meaning.
 */
export const assistantSampleEnabled: boolean = process.env.EXPO_PUBLIC_ASSISTANT_SAMPLE === 'true';
