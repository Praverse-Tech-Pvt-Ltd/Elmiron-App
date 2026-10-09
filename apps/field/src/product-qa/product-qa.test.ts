import { describe, expect, it } from 'vitest';
import { productQaRequestBody } from './contract';
import { productQaOutcome, productQaOutcomeFromThrown } from './outcome';

/**
 * W2-C C / `BE-W160` — what each gateway answer means on the Product Q&A screen.
 *
 * The case that matters most is the ordinary one TODAY: no approved material, so the server says
 * "not available" to every question. That must be its own honest state — never an error.
 */
const SOURCE = {
  chunkId: '11111111-1111-4111-8111-111111111111',
  documentTitle: 'Benchmarol SmPC',
  documentVersionId: '22222222-2222-4222-8222-222222222222',
  versionNumber: 3,
  heading: 'Dosage',
  sourceReference: 'SmPC §4.2',
};

describe('productQaOutcome', () => {
  it('NOT AVAILABLE is the honest first state — the server’s sentence, not an error', () => {
    const outcome = productQaOutcome({
      status: 200,
      body: {
        kind: 'not_available',
        requestId: 'r',
        message: 'Approved information is not available for this question.',
      },
    });
    expect(outcome).toEqual({
      kind: 'no_approved_information',
      text: 'Approved information is not available for this question.',
    });
  });

  it('an answer WITH its source is an answer', () => {
    expect(
      productQaOutcome({
        status: 200,
        body: {
          kind: 'answered',
          requestId: 'r',
          answer: 'Take 10 mg daily.',
          citations: [SOURCE],
        },
      }),
    ).toEqual({
      kind: 'answer',
      text: 'Take 10 mg daily.',
      sources: [
        {
          documentTitle: 'Benchmarol SmPC',
          versionNumber: 3,
          heading: 'Dosage',
          sourceReference: 'SmPC §4.2',
        },
      ],
    });
  });

  it('an answer with NO source, or a stub’s text, is NOT shown as an approved answer', () => {
    expect(
      productQaOutcome({
        status: 200,
        body: { kind: 'answered', requestId: 'r', answer: 'Take 10 mg daily.', citations: [] },
      }).kind,
    ).toBe('error');
    expect(
      productQaOutcome({
        status: 200,
        body: { kind: 'answered', requestId: 'r', answer: '[STUB] canned', citations: [SOURCE] },
      }).kind,
    ).toBe('error');
  });

  it('a patient-specific question is a refusal, in the server’s words', () => {
    expect(
      productQaOutcome({
        status: 200,
        body: { kind: 'patient_specific', requestId: 'r', message: 'Not about a patient.' },
      }),
    ).toEqual({ kind: 'refusal', text: 'Not about a patient.' });
  });

  it('switched off, at the limit (reset read from `allowance`), offline, and broken are each their own', () => {
    expect(productQaOutcome({ status: 403, body: { code: '45011' } })).toEqual({
      kind: 'switched_off',
    });
    expect(productQaOutcome({ status: 503, body: { code: 'no_provider' } })).toEqual({
      kind: 'switched_off',
    });
    expect(
      productQaOutcome({
        status: 429,
        body: { code: '45012', allowance: { resetsAt: '2026-10-07T00:00:00Z' } },
      }),
    ).toEqual({ kind: 'at_limit', resetsAt: '2026-10-07T00:00:00Z' });
    expect(productQaOutcomeFromThrown(new TypeError('Network request failed'))).toEqual({
      kind: 'offline',
    });
    expect(productQaOutcome({ status: 500, body: { code: 'gateway_error' } })).toEqual({
      kind: 'error',
    });
  });
});

describe('productQaRequestBody — a string in, so nothing else can ride along', () => {
  it('sends the feature and the question, trimmed', () => {
    expect(productQaRequestBody('  What is the dose?  ')).toEqual({
      feature: 'product_qa',
      question: 'What is the dose?',
    });
  });

  it('sends nothing for an empty question', () => {
    expect(productQaRequestBody('   ')).toBeNull();
  });

  it('with a product chosen, sends its id -- and with "Any product", no productId at all', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(productQaRequestBody('What is the dose?', id)).toEqual({
      feature: 'product_qa',
      question: 'What is the dose?',
      productId: id,
    });
    expect(productQaRequestBody('What is the dose?', null)).not.toHaveProperty('productId');
  });
});
