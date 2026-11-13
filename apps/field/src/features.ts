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
 * `FE-W163` — AI Doctor practice BY VOICE, hands-free: the rep speaks, pauses, and the doctor answers
 * out loud. Only with practice on. Off, the session screen is exactly the typed one. The rep's voice is
 * their own, in a practice with an AI — not a doctor and not a visit, so it is not the consultation
 * recording that stays off (D-15). It needs the AI service's speech models; without the key the
 * screen says so and typing carries on.
 */
export const practiceVoiceEnabled: boolean =
  practiceEnabled && process.env.EXPO_PUBLIC_PRACTICE_VOICE === 'true';

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

/**
 * The lesson tutor (`lms_tutor`): a question about the lesson on screen, answered only from that
 * lesson's own text by the gateway (a stub until a model is connected). Its own switch, off by
 * default like every AI feature, and only meaningful where Learning itself is on.
 */
export const lessonTutorEnabled: boolean =
  learningEnabled && process.env.EXPO_PUBLIC_LESSON_TUTOR === 'true';

/**
 * `FE-W71` / `BE-W180` — live tracking: the rep's position every few minutes, during working hours,
 * while the app is on screen, after the rep has accepted the notice, and only if their company has
 * switched it on.
 *
 * **Off by default.** Off, nothing of it exists in the app: no Me row, no status line, no watcher,
 * and `/live-tracking` goes to Today. On, the tracker is mounted at the root and obeys
 * `trackingState` (`src/integrations/tracking.ts`) — and the server re-checks every position anyway
 * (`record_location_ping`), so a build with the flag on and a company with the switch off records
 * nothing. Foreground only: background location stays blocked in the manifest.
 */
export const liveTrackingEnabled: boolean = process.env.EXPO_PUBLIC_LIVE_TRACKING === 'true';

/**
 * `FE-W85` — maps: the doctors' clinics and today's stops on a map, from the doctors list and the beat
 * plan.
 *
 * **Off by default, and off without a key.** On, the build must also carry
 * `GOOGLE_MAPS_ANDROID_API_KEY` (a client key restricted to this package and its signing SHA-1,
 * supplied at BUILD time and never committed), which `plugins/maps-push.cjs` writes into the
 * manifest; a build with this flag and no key is refused (`scripts/release-build-checks.mjs`, and the
 * plugin itself). Off, no map code path renders: no "Map" button, and `/map` goes to Today. The
 * keyless "Directions" (`src/integrations/maps.ts`) works either way.
 */
export const mapsEnabled: boolean = process.env.EXPO_PUBLIC_MAPS === 'true';

/**
 * `FE-W86` — push notifications through Firebase Cloud Messaging.
 *
 * **Off by default, and off without Firebase.** On, the build must also carry `GOOGLE_SERVICES_JSON`,
 * the PATH to the Firebase app's `google-services.json`, supplied at BUILD time and never committed;
 * a build with this flag and no file is refused. Off, nothing registers a token and nothing is
 * asked: `src/push/push-provider.tsx` is a passthrough.
 */
export const pushEnabled: boolean = process.env.EXPO_PUBLIC_PUSH === 'true';

/** A build-time value that is set, or null — unset and empty are the same: nothing configured. */
const configured = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * `FE-W195` — the company's help desk, for "Tell the help desk" on Saved on this phone (the queue).
 *
 * **Unset by default, and unset means the button does not exist** — the queue screen's rule since
 * S3: "absent until there is a help desk to tell". A button that opens nothing is the cruellest
 * thing to put on the screen a rep opens when work will not send.
 *
 * `EXPO_PUBLIC_SUPPORT_EMAIL` — an address. When set, the button opens the phone's mail app with a
 * message to it that already carries the queue's reference codes, so the help desk can look the
 * work up without the rep copying anything.
 * `EXPO_PUBLIC_SUPPORT_PHONE` — a number, dialled as given (include the country code, e.g.
 * `+912012345678`). Used only when no address is set: a call cannot carry the codes, which the screen
 * still shows.
 *
 * Both are inlined into the APK like every `EXPO_PUBLIC_*` value — a help-desk address is public by
 * nature, so nothing secret may go here. Read with dot access, for the reason at the top.
 */
export const supportEmail: string | null = configured(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);
export const supportPhone: string | null = configured(process.env.EXPO_PUBLIC_SUPPORT_PHONE);
