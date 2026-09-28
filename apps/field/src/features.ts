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
