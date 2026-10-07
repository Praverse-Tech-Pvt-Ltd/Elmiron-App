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

/**
 * FE-D17 — AI Doctor practice, on SAMPLE data.
 *
 * **Off by default, and off for the demo.** On, Me gains "AI Doctor practice" and `/practice`
 * opens: pick a scenario, practise with the AI doctor, get feedback. Every reply and score comes
 * from the sample in `src/practice/sample.ts`, nothing leaves the phone, and every screen says
 * "sample data". Off, the row does not exist and every practice route goes to Today.
 *
 * It becomes real practice when FE-CR-11 lands the practice contract on `main`. That change
 * replaces `src/practice/transport.ts`, not this flag's meaning.
 */
export const practiceSampleEnabled: boolean = process.env.EXPO_PUBLIC_PRACTICE_SAMPLE === 'true';

/**
 * W2-C C / `BE-W160` — Product Q&A, on the REAL transport.
 *
 * **Off by default.** Unlike the two above there is no sample behind it: on, it asks the real
 * `ai-gateway`, which today answers "approved information not available" to everything — true, and
 * the first thing a pilot company will see. Turned on when the company wants reps to see that answer,
 * or when approved material and model access are both in place.
 */
export const productQaEnabled: boolean = process.env.EXPO_PUBLIC_PRODUCT_QA === 'true';

/**
 * W2-F B — Learning: the courses assigned to the rep, their lessons, and recording a lesson finished,
 * on the REAL server.
 *
 * **Off by default.** No sample is behind it: on, it reads what the company has published and
 * assigned, which on a new company is nothing — and the screen says so. Turned on when courses exist
 * (there is no loader and no console authoring yet) and the company wants reps to see them. The lesson
 * tutor (`lms_tutor`) is a separate AI feature and is not behind this flag.
 */
export const learningEnabled: boolean = process.env.EXPO_PUBLIC_LEARNING === 'true';
