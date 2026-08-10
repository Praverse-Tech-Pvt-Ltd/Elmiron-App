import { describe, expect, it } from 'vitest';
import { CONSENT_OUTCOMES, ConsentOutcomeSchema, ConsentRecordSchema } from './field/consent.js';
import { ROLES } from './shared/identity.js';
import { AnalysisSchema, FindingSchema } from './field/analysis.js';
import { ApiErrorCodeSchema } from './shared/errors.js';

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
