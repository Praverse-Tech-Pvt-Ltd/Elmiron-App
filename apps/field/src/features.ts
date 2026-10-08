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
 * FE-D15 / W2-G A — the assistant, on the REAL transport.
 *
 * **Off by default, and off until model access and an approved `mr_chat` prompt both exist.** On, Me
 * gains an "Assistant" row and `app/assistant.tsx` asks the real `ai-gateway` as the signed-in rep.
 * Off, the row does not exist and a deep link goes to Today.
 *
 * W2-G A: this was `EXPO_PUBLIC_ASSISTANT_SAMPLE`, and on it showed a sample fixture. The wiring is
 * now live so that the day model access lands is a flag and a command — but **the flag stays off
 * while the only model is the stub**: a stubbed reply is a marker sentence no working system
 * produces (W1-P), and the screen shows "not available yet" for it, never an answer.
 */
export const assistantEnabled: boolean = process.env.EXPO_PUBLIC_ASSISTANT === 'true';

/**
 * FE-D17 / W2-G A — AI Doctor practice, on the REAL backend.
 *
 * **Off by default, and off until model access, approved `ai_doctor` and `ai_coach` prompts, and an
 * approved persona and scenario all exist.** On, Me gains "AI Doctor practice" and `/practice` opens:
 * pick a scenario, practise, get feedback — all from the server, as the signed-in rep. Off, the row
 * does not exist and every practice route goes to Today.
 *
 * W2-G A: this was `EXPO_PUBLIC_PRACTICE_SAMPLE` over a sample backend. Live now, off for the same
 * reason as the assistant: the stub's doctor speaks a marker sentence, and the coach scores zeros.
 */
export const practiceEnabled: boolean = process.env.EXPO_PUBLIC_PRACTICE === 'true';

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
