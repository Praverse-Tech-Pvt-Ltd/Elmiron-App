import { describe, expect, it } from 'vitest';
import { chatRequestBody } from './request';
import { outcomeFromGateway, outcomeFromThrown } from './outcome';
import { SAMPLE_ANSWER, SAMPLE_SCRIPT, sampleTransport } from './sample';

/**
 * FE-D15 — the assistant's logic, against the `mr_chat` contract on `worktree-ai-platform-phase-a`
 * (mirrored in `contract.ts` until FE-CR-7 lands it in `packages/core`).
 */

describe('the request carries only what the rep typed', () => {
  it('is exactly { feature, message }, with the typed text', () => {
    const body = chatRequestBody('  How do I submit a call report?  ');

    expect(body).toEqual({ feature: 'mr_chat', message: 'How do I submit a call report?' });
    expect(Object.keys(body ?? {}).sort()).toEqual(['feature', 'message']);
  });

  it('sends no history, so nothing earlier rides along', () => {
    expect(JSON.stringify(chatRequestBody('second question'))).not.toMatch(/history/u);
  });

  it('an empty message is not sent at all', () => {
    expect(chatRequestBody('   ')).toBeNull();
  });
});

describe('outcomeFromGateway — the mr_chat result', () => {
  it('an answer is an answer', () => {
    expect(
      outcomeFromGateway({
        status: 200,
        body: { kind: 'answered', requestId: 'r1', answer: 'Open Me, then How today ended.' },
      }),
    ).toEqual({
      kind: 'answer',
      text: 'Open Me, then How today ended.',
      allowance: { kind: 'not_reported' },
    });
  });

  it('a stub-marked "answer" is NEVER an answer', () => {
    const outcome = outcomeFromGateway({
      status: 200,
      body: {
        kind: 'answered',
        requestId: 'r1',
        answer: '[PRACTICE STUB - no AI provider is configured; decision #5 is open]',
      },
    });

    expect(outcome.kind).toBe('not_available');
  });

  it("an out-of-scope refusal is a refusal, in the server's own words", () => {
    expect(
      outcomeFromGateway({
        status: 200,
        body: { kind: 'out_of_scope', requestId: 'r1', message: 'Use Product Q&A.' },
      }),
    ).toEqual({ kind: 'refusal', text: 'Use Product Q&A.', allowance: { kind: 'not_reported' } });
  });

  it('a patient-specific refusal is a refusal too', () => {
    expect(
      outcomeFromGateway({
        status: 200,
        body: { kind: 'patient_specific', requestId: 'r1', message: 'Not about a patient.' },
      }).kind,
    ).toBe('refusal');
  });

  it('a failed flow is an error the rep can retry', () => {
    expect(
      outcomeFromGateway({
        status: 200,
        body: { kind: 'failed', requestId: 'r1', message: 'Try again.' },
      }).kind,
    ).toBe('error');
  });

  it('no model connected (503 no_provider) is "not available yet"', () => {
    expect(
      outcomeFromGateway({ status: 503, body: { code: 'no_provider', message: 'x' } }).kind,
    ).toBe('not_available');
  });

  it('feature switched off (403 45011) is "not available yet"', () => {
    expect(outcomeFromGateway({ status: 403, body: { code: '45011' } }).kind).toBe('not_available');
  });

  it('limit reached (429 45012) is at-limit, with no reset time unless the server sent one', () => {
    expect(outcomeFromGateway({ status: 429, body: { code: '45012' } })).toEqual({
      kind: 'at_limit',
      resetsAt: null,
    });
    expect(
      outcomeFromGateway({
        status: 429,
        body: { code: '45012', resetsAt: '2026-10-01T18:30:00.000Z' },
      }),
    ).toEqual({ kind: 'at_limit', resetsAt: '2026-10-01T18:30:00.000Z' });
  });

  it('a server error, or a body that is not the contract, is an error', () => {
    expect(outcomeFromGateway({ status: 500, body: { code: 'gateway_error' } }).kind).toBe('error');
    expect(outcomeFromGateway({ status: 200, body: { kind: 'answered' } }).kind).toBe('error');
    expect(outcomeFromGateway({ status: 200, body: 'hello' }).kind).toBe('error');
  });

  it('carries the allowance warning only when the server sent its figures (FE-CR-6)', () => {
    expect(
      outcomeFromGateway({
        status: 200,
        body: {
          kind: 'answered',
          requestId: 'r1',
          answer: 'Yes.',
          allowance: {
            warning: true,
            requestsUsedToday: 83,
            dailyLimit: 104,
            resetsAt: '2026-10-01T18:30:00.000Z',
          },
        },
      }),
    ).toEqual({
      kind: 'answer',
      text: 'Yes.',
      allowance: { kind: 'warning', used: 83, limit: 104, resetsAt: '2026-10-01T18:30:00.000Z' },
    });
  });

  it('below the warning line, there is no warning', () => {
    const outcome = outcomeFromGateway({
      status: 200,
      body: {
        kind: 'answered',
        requestId: 'r1',
        answer: 'Yes.',
        allowance: { warning: false, requestsUsedToday: 3, dailyLimit: 100, resetsAt: null },
      },
    });
    expect(outcome.kind === 'answer' ? outcome.allowance : null).toEqual({
      kind: 'not_reported',
    });
  });
});

describe('outcomeFromThrown', () => {
  it('a network failure is offline', () => {
    expect(outcomeFromThrown(new TypeError('Network request failed')).kind).toBe('offline');
  });

  it('anything else is an error', () => {
    expect(outcomeFromThrown(new Error('boom')).kind).toBe('error');
  });
});

describe('the sample fixture', () => {
  it('reaches every state through the same mapper', async () => {
    const kinds: string[] = [];
    for (const step of SAMPLE_SCRIPT) {
      try {
        kinds.push(
          outcomeFromGateway(await sampleTransport({ feature: 'mr_chat', message: step.ask })).kind,
        );
      } catch (error) {
        kinds.push(outcomeFromThrown(error).kind);
      }
    }
    expect(new Set(kinds)).toEqual(
      new Set(['answer', 'refusal', 'not_available', 'at_limit', 'offline', 'error']),
    );
  });

  it('its answer says it is a sample', () => {
    expect(SAMPLE_ANSWER).toMatch(/^Sample answer/u);
  });
});
