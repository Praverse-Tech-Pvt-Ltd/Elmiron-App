import { describe, expect, it } from 'vitest';
import {
  createLiveLessonTutorTransport,
  lessonTutorOutcome,
  lessonTutorOutcomeFromThrown,
  lessonTutorRequestBody,
} from './tutor';

const LESSON = '55555555-5555-4555-8555-555555555555';

describe('lesson tutor — the request', () => {
  it('sends the lesson and the trimmed question; nothing for an empty one', () => {
    expect(lessonTutorRequestBody(LESSON, '  Why the cold chain?  ')).toEqual({
      feature: 'lms_tutor',
      lessonId: LESSON,
      question: 'Why the cold chain?',
    });
    expect(lessonTutorRequestBody(LESSON, '   ')).toBeNull();
  });

  it('the transport sends exactly that to the gateway', async () => {
    const calls: string[] = [];
    const fake = ((_url: string, init: { body: string }) => {
      calls.push(init.body);
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;
    const body = lessonTutorRequestBody(LESSON, 'Why?');
    if (body === null) throw new Error('no body');
    await createLiveLessonTutorTransport({
      baseUrl: 'http://server.test',
      apiKey: 'k',
      accessToken: () => Promise.resolve('t'),
      fetch: fake,
    })(body);
    expect(JSON.parse(calls[0] ?? '{}')).toEqual({
      feature: 'lms_tutor',
      lessonId: LESSON,
      question: 'Why?',
    });
  });
});

describe('lesson tutor — what came back', () => {
  it('an explanation from the lesson', () => {
    expect(
      lessonTutorOutcome({
        status: 200,
        body: { kind: 'explained', explanation: 'Because heat degrades it.' },
      }),
    ).toEqual({ kind: 'explained', text: 'Because heat degrades it.' });
  });

  it('the stub placeholder is never shown as an explanation', () => {
    expect(
      lessonTutorOutcome({
        status: 200,
        body: { kind: 'explained', explanation: '[stub] sample' },
      }),
    ).toEqual({ kind: 'switched_off' });
  });

  it('not in the lesson, and patient detail, are said as the server said them', () => {
    expect(
      lessonTutorOutcome({
        status: 200,
        body: { kind: 'not_in_lesson', message: 'This lesson does not cover that.' },
      }),
    ).toEqual({ kind: 'not_in_lesson', text: 'This lesson does not cover that.' });
    expect(
      lessonTutorOutcome({
        status: 200,
        body: { kind: 'patient_specific', message: 'No patients.' },
      }),
    ).toEqual({ kind: 'refusal', text: 'No patients.' });
  });

  it('switched off, no model, at the limit, failed, offline', () => {
    expect(lessonTutorOutcome({ status: 403, body: { code: '45011' } })).toEqual({
      kind: 'switched_off',
    });
    expect(lessonTutorOutcome({ status: 503, body: { code: 'no_provider' } })).toEqual({
      kind: 'switched_off',
    });
    expect(
      lessonTutorOutcome({
        status: 429,
        body: { code: '45012', allowance: { resetsAt: '2026-10-10T00:00:00Z' } },
      }),
    ).toEqual({ kind: 'at_limit', resetsAt: '2026-10-10T00:00:00Z' });
    expect(lessonTutorOutcome({ status: 200, body: { kind: 'failed', message: 'x' } })).toEqual({
      kind: 'error',
    });
    expect(lessonTutorOutcomeFromThrown(new TypeError('Network request failed'))).toEqual({
      kind: 'offline',
    });
  });
});
