import { describe, expect, it } from 'vitest';
import { CONSENT_OUTCOMES, ConsentOutcomeSchema, ConsentRecordSchema } from './field/consent.js';
import { ROLES } from './shared/identity.js';
import { AnalysisSchema, FindingSchema } from './field/analysis.js';
import { ApiErrorCodeSchema } from './shared/errors.js';
import { ProductSchema } from './field/catalogue.js';
import {
  CompleteLessonResponseSchema,
  CourseAssignmentSchema,
  CourseEnrolmentSchema,
  CourseModuleSchema,
  CourseSchema,
  CourseVersionSchema,
  LessonCompletionSchema,
  LessonSchema,
  LMS_RPC,
  StartCourseVersionResponseSchema,
} from './field/lms.js';
// W1-A B2. `contract.test.ts` guarded `catalogue.ts` and `lms.ts` only; the AI control plane, the
// knowledge store and the gateway had no contract guard at all — the three newest and least
// exercised surfaces in the package.
import { AI_FEATURES, AI_RPC, AiRequestSchema, aiFeatureFlagKey } from './field/ai.js';
import {
  KNOWLEDGE_RPC,
  KNOWLEDGE_VERSION_STATUSES,
  KnowledgeDocumentVersionSchema,
} from './field/knowledge.js';
import {
  PATIENT_SPECIFIC_REFUSAL_MESSAGE,
  detectPatientSignals,
} from './field/gateway/guardrails.js';
import { API_PATHS } from './field/endpoints.js';
import {
  SIM_COACH_DIMENSIONS,
  SimCoachAnalysisSchema,
  SimCoachFindingSchema,
  SimCoachModuleCandidateSchema,
  SimCoachOutputSchema,
  SimCoachSuggestedModuleSchema,
  SimSessionSchema,
} from './field/simulation.js';

/**
 * These are contract guards, not unit tests. Each one fails if someone later
 * weakens a rule that the brief calls non-negotiable.
 */

describe('roles', () => {
  it('has exactly three, and no others', () => {
    expect(ROLES).toEqual(['mr', 'field_manager', 'admin']);
  });
});

describe('consent outcomes', () => {
  it('has exactly three values', () => {
    expect(CONSENT_OUTCOMES).toEqual(['consented', 'declined', 'not_asked']);
  });

  it.each(CONSENT_OUTCOMES)('accepts %s as a valid completed outcome', (outcome) => {
    expect(ConsentOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it('models a declined consent as an ordinary valid record', () => {
    const declined = {
      id: '3f1a9d5e-6b2c-4c8a-9e21-0f7b1c5d8a44',
      visitId: '9c2b7e14-5a3d-4f6b-8c90-1d2e3f4a5b6c',
      doctorId: '5d4c3b2a-1f0e-4a9b-8c7d-6e5f4a3b2c1d',
      capturedByMrId: '11111111-2222-4333-8444-555555555555',
      outcome: 'declined',
      notAskedReason: null,
      consentTextVersionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      displayedLanguage: 'hi-IN',
      supersedesConsentRecordId: null,
      isWithdrawal: false,
      capturedAt: '2026-08-10T09:15:00+05:30',
      receivedAt: '2026-08-10T09:15:02+05:30',
      createdAt: '2026-08-10T09:15:01+05:30',
    };
    expect(ConsentRecordSchema.safeParse(declined).success).toBe(true);
  });

  it('carries no penalty, flag or score field on a consent record', () => {
    const forbidden = ['penalty', 'flagged', 'score', 'isFailure', 'compliant'];
    const keys = Object.keys(ConsentRecordSchema.shape);
    for (const field of forbidden) {
      expect(keys).not.toContain(field);
    }
  });

  it('models withdrawal as a new row referencing the original', () => {
    const keys = Object.keys(ConsentRecordSchema.shape);
    expect(keys).toContain('supersedesConsentRecordId');
    expect(keys).toContain('isWithdrawal');
  });

  it('requires the displayed text version and language on every record', () => {
    const keys = Object.keys(ConsentRecordSchema.shape);
    expect(keys).toContain('consentTextVersionId');
    expect(keys).toContain('displayedLanguage');
  });
});

describe('analysis', () => {
  it('has no composite score, rating or rank field', () => {
    const forbidden = ['score', 'rating', 'rank', 'percentile', 'grade'];
    const keys = Object.keys(AnalysisSchema.shape);
    for (const field of forbidden) {
      expect(keys).not.toContain(field);
    }
  });

  it('rejects a finding with no citation', () => {
    const uncited = {
      id: '11111111-1111-4111-8111-111111111111',
      analysisId: '22222222-2222-4222-8222-222222222222',
      category: 'opening',
      severity: 'improvement',
      title: 'Purpose not established',
      detail: 'No stated purpose in the opening.',
      citations: [],
      createdAt: '2026-08-10T09:15:00+05:30',
    };
    expect(FindingSchema.safeParse(uncited).success).toBe(false);
  });
});

describe('api errors', () => {
  it('has a distinct permission_denied code', () => {
    expect(ApiErrorCodeSchema.options).toContain('permission_denied');
  });
});

describe('LMS (AI-B2) — no score on the manager surface until X2 is decided', () => {
  // `.ai-collab/constraints.md` forbids a score on the manager surface, and managers read
  // enrolments, assignments and completions. Whether training is exempt is X2
  // (`docs/ai-platform/phase-a-recon.md`); until someone rules, the contract holds the line.
  const lmsSchemas = {
    CourseSchema,
    CourseVersionSchema,
    CourseModuleSchema,
    LessonSchema,
    CourseAssignmentSchema,
    CourseEnrolmentSchema,
    LessonCompletionSchema,
    CompleteLessonResponseSchema,
    StartCourseVersionResponseSchema,
  };
  const forbidden = /(score|grade|rank|percent|rating|passed|failed|passMark|marks?$)/i;

  it.each(Object.entries(lmsSchemas))('%s carries no score-like field', (_name, schema) => {
    expect(Object.keys(schema.shape).filter((k) => forbidden.test(k))).toEqual([]);
  });
});

describe('AI control plane (AI-D0) — W1-A B2', () => {
  it('has no patient-facing feature, and C25 is the reason', () => {
    // `C25` / X1: patient-facing AI lives in the clinical project. A feature id here is the only
    // thing `ai_begin_request` will accept, so its absence is the enforcement, not a convention.
    expect(AI_FEATURES).not.toContain('patient_education');
  });

  it('names every feature this release declared in scope', () => {
    // `C22`/`C23` put simulation, coaching-on-simulation and the tutor in scope. If a feature id
    // were renamed, the spec's flow tables would point at nothing.
    for (const feature of [
      'mr_chat',
      'product_qa',
      'lms_tutor',
      'ai_doctor',
      'ai_coach',
    ] as const) {
      expect(AI_FEATURES).toContain(feature);
    }
  });

  it('keeps the out-of-scope features declared but off — deleting an id would lose the flag', () => {
    // `C21`/`C29`: these three stay OUT this release. They remain declared so their flags exist
    // and can be asserted false; an undeclared feature has no flag to keep off.
    for (const feature of ['transcript_analysis', 'pv_screening', 'complaint_screening'] as const) {
      expect(AI_FEATURES).toContain(feature);
    }
  });

  it('gives every feature a distinct flag key, so one cannot switch on another', () => {
    const keys = AI_FEATURES.map(aiFeatureFlagKey);
    expect(new Set(keys).size).toBe(AI_FEATURES.length);
  });

  it('the request log has NO column for the question or the answer (master prompt §52)', () => {
    // The strongest privacy property of the control plane is structural: there is nowhere to put
    // the text. A field added "for debugging" would silently end that.
    const keys = Object.keys(AiRequestSchema.shape);
    const textish = /(prompt|question|answer|message|content|text|body|response|completion)/i;
    // `promptVersionId` is an id, not text — excluded by name, deliberately and visibly.
    expect(keys.filter((k) => textish.test(k) && k !== 'promptVersionId')).toEqual([]);
  });

  it('carries no score, rank or rating on an AI request — C27 holds here too', () => {
    const forbidden = /(score|grade|rank|percent|rating)/i;
    expect(Object.keys(AiRequestSchema.shape).filter((k) => forbidden.test(k))).toEqual([]);
  });
});

describe('approved knowledge (AI-C1) — W1-A B2', () => {
  it('has a draft state, because C24 requires AI text to enter as one', () => {
    expect(KNOWLEDGE_VERSION_STATUSES).toContain('draft');
    expect(KNOWLEDGE_VERSION_STATUSES).toContain('in_review');
    expect(KNOWLEDGE_VERSION_STATUSES).toContain('approved');
  });

  it('carries the four-eyes columns the approval path depends on', () => {
    // `C26`: the operator approves and cannot approve their own. The author, the submitter and
    // the decider must be separately recorded or the rule cannot be checked at all.
    const keys = Object.keys(KnowledgeDocumentVersionSchema.shape);
    for (const field of [
      'createdByUserId',
      'submittedByUserId',
      'decidedByUserId',
      'approvalAttestation',
    ]) {
      expect(keys).toContain(field);
    }
  });

  it('records where the text came from, which C24 makes load-bearing', () => {
    // A reviewer approving AI-drafted training text needs to see its provenance. `sourceReference`
    // is required (never nullable) so a version cannot exist without saying where it came from.
    expect(Object.keys(KnowledgeDocumentVersionSchema.shape)).toContain('sourceReference');
    expect(KnowledgeDocumentVersionSchema.shape.sourceReference.safeParse('').success).toBe(false);
  });

  it('a version about a product can name its market — C24 and §47', () => {
    // The market is what lets a reviewer see that a draft has crossed from training text into
    // regulated promotional content for a particular country.
    expect(Object.keys(KnowledgeDocumentVersionSchema.shape)).toContain('marketId');
  });
});

describe('the gateway (AI-D1) — W1-A B2', () => {
  it('refuses a question carrying a phone number', () => {
    expect(detectPatientSignals('patient on 98765 43210, what dose?').length).toBeGreaterThan(0);
  });

  it('refuses a request for advice about an individual', () => {
    expect(
      detectPatientSignals('my patient is 62 and diabetic, what should he take?').length,
    ).toBeGreaterThan(0);
  });

  it('does not fire on an ordinary product question — the positive control', () => {
    // Without this, a guardrail that refused everything would pass every test above.
    expect(detectPatientSignals('what is the dosing interval for this product?')).toEqual([]);
  });

  it('the refusal sentence never echoes what was typed', () => {
    // §10's wording. The message is a constant, so it structurally cannot contain user text.
    expect(PATIENT_SPECIFIC_REFUSAL_MESSAGE).not.toMatch(/\$\{|%s/);
    expect(PATIENT_SPECIFIC_REFUSAL_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe('route wiring — W1-A B1', () => {
  const declared = new Set(Object.values(API_PATHS).filter((v) => typeof v === 'string'));

  it.each(Object.values(LMS_RPC))('LMS rpc %s has a declared path', (name) => {
    expect(declared).toContain(`/rpc/${name}`);
  });

  it.each(Object.values(KNOWLEDGE_RPC))('knowledge rpc %s has a declared path', (name) => {
    expect(declared).toContain(`/rpc/${name}`);
  });

  it('the four prompt-version RPCs have declared paths', () => {
    for (const name of [
      AI_RPC.submitAiPromptVersion,
      AI_RPC.approveAiPromptVersion,
      AI_RPC.rejectAiPromptVersion,
      AI_RPC.retireAiPromptVersion,
    ]) {
      expect(declared).toContain(`/rpc/${name}`);
    }
  });

  it('the two GATEWAY rpcs are deliberately NOT declared', () => {
    // `ai_begin_request` and `ai_complete_request` belong to the gateway (`#4`), called as the
    // user by a runtime that does not exist. A path here would invite an app to call them
    // directly, which would put the model call in the client. This assertion is the record of
    // that choice, so removing it is a decision rather than an oversight.
    expect(declared).not.toContain(`/rpc/${AI_RPC.aiBeginRequest}`);
    expect(declared).not.toContain(`/rpc/${AI_RPC.aiCompleteRequest}`);
  });
});

describe('AI Doctor (W1-D) — a practice score is not a leaderboard', () => {
  it('carries no team, cohort, rank, percentile or comparison field', () => {
    // `C27` permits a score on a PRACTICE session, visible to the MR and the company admin. What it
    // does not permit is a manager surface or a team average -- and the cheapest way to get one by
    // accident is a field that invites a GROUP BY. Asserted by name so adding one is a red test.
    const forbidden =
      /(team|cohort|rank|percentile|average|median|peer|comparison|leaderboard|position)/i;
    const offenders = Object.keys(SimCoachAnalysisSchema.shape).filter((k) => forbidden.test(k));
    expect(offenders).toEqual([]);
  });

  it('W1-M C4: the NESTED shapes carry no comparison field either — scores, findings, modules', () => {
    // The top-level check above cannot see inside `dimensionScores` or a suggested module, and W1-M
    // added keys at both depths. A `team_average` dimension or a module's `peerRank` would slip past
    // a check that only reads one level. `position` is matched too, which is why a module carries no
    // course position even though the table has one.
    const forbidden =
      /(team|cohort|rank|percentile|average|median|peer|comparison|leaderboard|position)/i;
    const nested = [
      ...Object.keys(SimCoachAnalysisSchema.shape.dimensionScores.shape),
      ...Object.keys(SimCoachFindingSchema.shape),
      ...Object.keys(SimCoachSuggestedModuleSchema.shape),
      ...Object.keys(SimCoachModuleCandidateSchema.shape),
    ];
    expect(nested.filter((k) => forbidden.test(k))).toEqual([]);
  });

  it('a session carries no score at all — the score lives on the analysis', () => {
    // Two places to read a score from is one place for them to disagree.
    const scoreish = /(score|grade|rating|rank)/i;
    expect(Object.keys(SimSessionSchema.shape).filter((k) => scoreish.test(k))).toEqual([]);
  });

  it('every coach finding must cite a turn — an unciteable criticism is not feedback', () => {
    const uncited = { dimension: 'opening', title: 'T', detail: 'D' };
    expect(SimCoachFindingSchema.safeParse(uncited).success).toBe(false);
    expect(SimCoachFindingSchema.safeParse({ ...uncited, turnIndex: 1 }).success).toBe(true);
  });

  it('the SEVEN scored dimensions are a closed set (W1-M, BE-C34)', () => {
    // If a model could invent a dimension, two analyses would not be comparable and no screen could
    // label them -- the same reason `ai_complete_request` refuses an invented flag. Seven, not nine:
    // the operator's other two items are `improvements` and `suggestedModules`, which are not scores.
    expect([...SIM_COACH_DIMENSIONS]).toEqual([
      'opening',
      'product_knowledge',
      'scientific_accuracy',
      'objection_handling',
      'response_relevance',
      'communication',
      'closing',
    ]);
    // ...and the score object requires exactly those keys, so the list and the shape cannot drift.
    expect(Object.keys(SimCoachAnalysisSchema.shape.dimensionScores.shape).sort()).toEqual(
      [...SIM_COACH_DIMENSIONS].sort(),
    );
  });

  it('BE-C34 all nine items exist on the analysis, under their contract names', () => {
    const keys = Object.keys(SimCoachOutputSchema.shape);
    expect(keys).toEqual(expect.arrayContaining(['dimensionScores', 'improvements']));
    expect(keys).toContain('suggestedModules');
  });

  it('an analysis missing a NEW dimension is refused — scientific_accuracy is not optional', () => {
    const full = Object.fromEntries(SIM_COACH_DIMENSIONS.map((d) => [d, 50]));
    const scores = SimCoachAnalysisSchema.shape.dimensionScores;
    expect(scores.safeParse(full).success).toBe(true);
    const withoutScience = Object.fromEntries(
      Object.entries(full).filter(([k]) => k !== 'scientific_accuracy'),
    );
    expect(scores.safeParse(withoutScience).success).toBe(false);
  });

  it('a suggested module needs a module id, a known dimension and a reason — and at most three', () => {
    const ok = {
      moduleId: '6f1c2b8e-1d0a-4c4e-9b8f-0a1b2c3d4e5f',
      dimension: 'scientific_accuracy',
      reason: 'Your answer on storage temperature contradicted the label.',
    };
    expect(SimCoachSuggestedModuleSchema.safeParse(ok).success).toBe(true);
    expect(SimCoachSuggestedModuleSchema.safeParse({ ...ok, reason: '' }).success).toBe(false);
    expect(SimCoachSuggestedModuleSchema.safeParse({ ...ok, moduleId: 'Cardio 101' }).success).toBe(
      false,
    );
    expect(SimCoachSuggestedModuleSchema.safeParse({ ...ok, dimension: 'charm' }).success).toBe(
      false,
    );
    const list = SimCoachOutputSchema.shape.suggestedModules;
    expect(list.safeParse([]).success, 'empty is honest when nothing fits').toBe(true);
    expect(list.safeParse([ok, ok, ok, ok]).success, 'four is refused').toBe(false);
  });

  it('a score outside 0-100 is refused, both ends', () => {
    const base = {
      overallScore: 50,
      dimensionScores: {
        opening: 1,
        product_knowledge: 1,
        scientific_accuracy: 1,
        objection_handling: 1,
        response_relevance: 1,
        communication: 1,
        closing: 1,
      },
    };
    expect(SimCoachAnalysisSchema.shape.overallScore.safeParse(-1).success).toBe(false);
    expect(SimCoachAnalysisSchema.shape.overallScore.safeParse(101).success).toBe(false);
    expect(SimCoachAnalysisSchema.shape.overallScore.safeParse(base.overallScore).success).toBe(
      true,
    );
  });
});

describe('catalogue (AI-B1) — identity only', () => {
  it('a product carries no claim, indication, dose or label field', () => {
    expect(Object.keys(ProductSchema.shape).sort()).toEqual(
      [
        'brandName',
        'createdAt',
        'genericName',
        'id',
        'isActive',
        'organisationId',
        'therapyAreaId',
        'updatedAt',
      ].sort(),
    );
  });
});
