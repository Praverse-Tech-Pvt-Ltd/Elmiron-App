import type { LlmGenerateRequest, LlmProvider, LlmResult } from './core.ts';

/**
 * W1-B C2 — the ONE adapter that ships, and it is a stub that says so.
 *
 * **`#5` / `D2` is open (`C31`): no vendor is chosen, and this repository still names none.** The
 * brief for this session asked for an adapter that is *explicit about being a stub and can never be
 * enabled outside a local target*. Both halves are load-bearing:
 *
 * * **Explicit**, because a stub that returns plausible text is the most dangerous object in an AI
 *   codebase. Someone demonstrates the feature, it answers, and nobody discovers there was no model
 *   until a rep repeats the answer to a doctor. So every answer this thing produces is **visibly
 *   not an answer**: it sets `supported: false`, which `answerProductQuestion` turns into the
 *   "approved information not available" sentence, and it names itself `stub` in the request log's
 *   `model_provider` column so the audit trail records that no model ran.
 * * **Cannot be enabled outside a local target**, because the alternative is a deployment serving
 *   refusals that look like a model declining. It THROWS on construction rather than returning a
 *   quiet `null`, for the same reason `loadAppConfig` throws on `APP_RECORDING_ENABLED` against a
 *   deployment (`packages/core/src/shared/config.ts:79-92`): silently ignoring the request leaves
 *   whoever set it believing the feature is on.
 *
 * **The real adapter is one file next to this one**, added the day `#5` is answered. It implements
 * the same `LlmProvider` interface, and nothing in `answerProductQuestion` changes.
 */

export const stubProviderRefusal =
  'No AI provider is configured. Decision #5 (which provider, and may data leave India) is open, ' +
  'so this build has no model adapter. The stub provider runs only against a local Supabase.';

/**
 * The same host set `packages/core/src/shared/config.ts` uses and for the same reason: a rule about
 * "is this a deployment" must be ONE rule. Duplicated here rather than imported because that module
 * pulls in zod and the app config schema, which an Edge Function has no use for — the list is three
 * strings and the comment is the thing that keeps them aligned.
 */
const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', 'host.docker.internal', 'kong'];

export const isLocalTarget = (rawUrl: string | undefined): boolean => {
  if (rawUrl === undefined || rawUrl === '') return false;
  try {
    return LOCAL_HOSTS.includes(new URL(rawUrl).hostname);
  } catch {
    // An unparseable URL is NOT treated as local. Erring toward denial is the standing rule
    // (`constraints.md`: "Err toward denial when evidence is missing").
    return false;
  }
};

/** What the stub claims to be, in the audit trail. Asserted by a test, so it cannot drift. */
export const STUB_PROVIDER_NAME = 'stub';
export const STUB_MODEL_NAME = 'no-model-configured';

/**
 * Counts calls, so a test can prove the guardrail refused BEFORE any provider call (W1-B C4).
 * Module-scoped on purpose: the assertion that matters is "the provider was never reached", and
 * that can only be made by something the provider itself increments.
 */
let callCount = 0;
export const stubProviderCallCount = (): number => callCount;
export const resetStubProviderCallCount = (): void => {
  callCount = 0;
};

/**
 * Which output shape the stub must produce. W1-D B4 made this necessary: `ai_doctor` and `ai_coach`
 * validate against different schemas, and a stub returning `product_qa`'s shape fails both --
 * indistinguishably from a real model returning nonsense, which would make the gateway's validation
 * untestable.
 */
export type StubShape = 'product_qa' | 'mr_chat' | 'lms_tutor' | 'sim_doctor' | 'sim_coach';

/**
 * **Every stub reply SAYS it is a stub, in the text a human would read.**
 *
 * This is W1-C E2's ruling applied in code rather than in a document: *a plausible sentence teaches
 * the room the thing works.* A stubbed doctor that said "Yes, tell me more about the dosing" would be
 * indistinguishable from a working feature to anyone watching, including the person who built it.
 */
const STUB_MARKER =
  '[PRACTICE STUB - no AI provider is configured; decision #5 is open, so no model was called]';

/**
 * W1-N D1 -- the ONE place a test can steer the stub, and only the coach's module suggestion.
 *
 * Before this, the stub always returned `suggestedModules: []`, so the populated path -- a module
 * stored on the analysis, or one refused for not being offered -- had never run over HTTP. A test
 * now puts a directive in the session's `objective`, which reaches the prompt verbatim:
 *
 *   [STUB:suggest-offered]    suggest the FIRST module the flow offered (`AVAILABLE MODULES`)
 *   [STUB:suggest-unoffered]  suggest an id that was NOT offered, so the refusal runs end to end
 *
 * Without a directive the reply is unchanged: no suggestion, because a stub recommending a course
 * would be read as advice. With one, the REASON is the stub marker, so even a stored suggestion
 * says on its face that no model chose it. The stub refuses to exist outside a local target, so a
 * directive typed into a real session reaches nothing.
 */
const STUB_UNOFFERED_MODULE_ID = '00000000-0000-4000-8000-00000000dead';

const stubSuggestedModules = (request: LlmGenerateRequest): unknown[] => {
  const prompt = request.messages.map((m) => m.content).join('\n');
  const directive = /\[STUB:(suggest-offered|suggest-unoffered)\]/u.exec(prompt)?.[1];
  if (directive === undefined) return [];
  if (directive === 'suggest-unoffered') {
    return [{ moduleId: STUB_UNOFFERED_MODULE_ID, dimension: 'closing', reason: STUB_MARKER }];
  }
  const line = /^AVAILABLE MODULES \(JSON\): (.*)$/mu.exec(prompt)?.[1] ?? '[]';
  const offered = JSON.parse(line) as { moduleId: string }[];
  const first = offered[0];
  return first === undefined
    ? []
    : [{ moduleId: first.moduleId, dimension: 'scientific_accuracy', reason: STUB_MARKER }];
};

/**
 * W1-P D2 -- the stub's BLIND SPOTS, closed. Each feature's default reply below takes ONE branch of
 * its flow; every other branch had never run over HTTP. A test now names the branch it wants in the
 * user's own text, which reaches the prompt verbatim:
 *
 *   all five        [STUB:invalid]               not JSON           -> the schema-invalid branch
 *                   [STUB:provider-error]        generate() throws  -> the provider-error branch
 *   product_qa      [STUB:cite-supplied]         supported, citing the first supplied passage -> ANSWERED
 *                   [STUB:cite-unsupplied]       supported, citing a passage NOT supplied     -> refused
 *   mr_chat         [STUB:in-scope]              in scope, a plain answer                     -> ANSWERED
 *                   [STUB:in-scope-clinical]     in scope, a dosing claim in the answer       -> refused
 *   lms_tutor       [STUB:grounded]              grounded, a plain explanation                -> EXPLAINED
 *                   [STUB:grounded-clinical]     grounded, a dosing claim                     -> refused
 *   ai_doctor       [STUB:objection-addressed]   objectionAddressed: true                     -> REPLIED
 *   ai_coach        [STUB:cite-turn-2]           an improvement citing turn 2                 -> ANALYSED
 *                   [STUB:cite-missing-turn]     a finding citing turn 99                     -> refused
 *
 * **Every text a directive produces still carries STUB_MARKER**, so no output -- stored, shown or
 * logged -- can be mistaken for a model's. Scores stay zero under every directive: a non-zero stub
 * score would read as a judgement. Without a directive nothing changes. The stub refuses to exist
 * outside a local target, so a directive typed into a real session reaches nothing.
 *
 * **This does not deepen the stub**: it adds no capability, it exposes branches the stub was hiding.
 */
const STUB_UNSUPPLIED_CHUNK_ID = '00000000-0000-4000-8000-0000000c0de0';
const STUB_CLINICAL = `${STUB_MARKER} Take 400mg twice daily.`;

const directiveOf = (request: LlmGenerateRequest): string | undefined =>
  /\[STUB:([a-z0-9-]+)\]/u.exec(request.messages.map((m) => m.content).join('\n'))?.[1];

const stubBody = (shape: StubShape, request: LlmGenerateRequest): string => {
  const directive = directiveOf(request);
  if (directive === 'invalid') return `${STUB_MARKER} -- deliberately not JSON`;
  switch (shape) {
    case 'product_qa': {
      if (directive === 'cite-supplied' || directive === 'cite-unsupplied') {
        const supplied = /\bid=([0-9a-f-]{36})\b/u.exec(
          request.messages.map((m) => m.content).join('\n'),
        )?.[1];
        const cited = directive === 'cite-supplied' ? supplied : STUB_UNSUPPLIED_CHUNK_ID;
        return JSON.stringify({
          supported: true,
          answer: STUB_MARKER,
          citedChunkIds: cited === undefined ? [] : [cited],
        });
      }
      // `supported: false` is the whole design: the one reply that cannot be mistaken for an answer.
      // `answerProductQuestion` maps it to KNOWLEDGE_NOT_AVAILABLE_MESSAGE, verbatim.
      return JSON.stringify({ supported: false, answer: '', citedChunkIds: [] });
    }
    case 'mr_chat':
      if (directive === 'in-scope') return JSON.stringify({ inScope: true, answer: STUB_MARKER });
      if (directive === 'in-scope-clinical') {
        return JSON.stringify({ inScope: true, answer: STUB_CLINICAL });
      }
      // `inScope: false` is the same choice `product_qa` makes with `supported: false`: the one
      // reply that cannot be mistaken for an answer. `answerMrChat` maps it to the out-of-scope
      // redirect, so a stubbed chat sends the rep to Product Q&A rather than saying something.
      return JSON.stringify({ inScope: false, answer: '' });
    case 'lms_tutor':
      if (directive === 'grounded') {
        return JSON.stringify({ groundedInLesson: true, explanation: STUB_MARKER });
      }
      if (directive === 'grounded-clinical') {
        return JSON.stringify({ groundedInLesson: true, explanation: STUB_CLINICAL });
      }
      // `groundedInLesson: false` is the same choice `product_qa` makes with `supported: false` and
      // `mr_chat` with `inScope: false`: the one reply that cannot be mistaken for teaching. The flow
      // maps it to the referral sentence, so a stubbed tutor sends the learner to a person.
      return JSON.stringify({ groundedInLesson: false, explanation: '' });
    case 'sim_doctor':
      // Schema-valid so the gateway's validation is exercised, and visibly a stub so nobody mistakes
      // it for a doctor. `objectionAddressed: false` keeps the practice loop honest -- a stub cannot
      // judge whether the rep answered anything -- unless a test asks for the other branch.
      return JSON.stringify({
        reply: STUB_MARKER,
        objectionAddressed: directive === 'objection-addressed',
      });
    case 'sim_coach': {
      const improvementTurn =
        directive === 'cite-turn-2' ? 2 : directive === 'cite-missing-turn' ? 99 : 1;
      // Scores are all zero ON PURPOSE. A stub returning 72/100 would be read as a judgement, and a
      // rep would believe it. Zero with a stub summary cannot be mistaken for feedback.
      return JSON.stringify({
        overallScore: 0,
        dimensionScores: {
          opening: 0,
          product_knowledge: 0,
          scientific_accuracy: 0,
          objection_handling: 0,
          response_relevance: 0,
          communication: 0,
          closing: 0,
        },
        strengths: [
          { dimension: 'opening', title: STUB_MARKER, detail: STUB_MARKER, turnIndex: 1 },
        ],
        improvements: [
          {
            dimension: 'closing',
            title: STUB_MARKER,
            detail: STUB_MARKER,
            turnIndex: improvementTurn,
          },
        ],
        // EMPTY unless a test asks otherwise (W1-N D1, `stubSuggestedModules`), for the reason the
        // scores are zero: a stub that recommended a course would be read as advice.
        suggestedModules: stubSuggestedModules(request),
        summary: STUB_MARKER,
      });
    }
  }
};

export const createStubProvider = (shape: StubShape = 'product_qa'): LlmProvider => {
  if (!isLocalTarget(Deno.env.get('SUPABASE_URL'))) {
    throw new Error(stubProviderRefusal);
  }
  return {
    generate: (request: LlmGenerateRequest): Promise<LlmResult> => {
      callCount += 1;
      if (directiveOf(request) === 'provider-error') {
        // W1-P D2: the provider failing outright -- the branch every flow maps to its failure
        // sentence and records as `provider_error`.
        return Promise.reject(new Error(`${STUB_MARKER} -- deliberate provider error`));
      }
      const text = stubBody(shape, request);
      return Promise.resolve({
        text,
        usage: {
          // Honest, cheap token counts so the cost columns are exercised end to end rather than
          // left null -- W1-B C3 asks that the result be audited WITH its cost fields.
          inputTokens: request.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
          outputTokens: Math.ceil(text.length / 4),
        },
        provider: STUB_PROVIDER_NAME,
        model: STUB_MODEL_NAME,
      });
    },
  };
};
