import { postGateway } from '../live-rest';
import type { LiveConnection } from '../live-rest';
import type { GatewayResponse } from '../assistant/contract';

/**
 * The lesson tutor (`lms_tutor`), as the lesson screen speaks it.
 *
 * The gateway answers ONLY from the lesson's own published text, discards an answer the model does
 * not say is grounded in it, refuses a clinical question in code, and refuses patient detail before
 * any model (`packages/core/src/field/gateway/lms-tutor.ts`). This module sends the question and
 * names what came back; it decides nothing about the answer itself.
 */
export const LESSON_TUTOR_FEATURE = 'lms_tutor';

export interface LessonTutorRequestBody {
  readonly feature: typeof LESSON_TUTOR_FEATURE;
  readonly lessonId: string;
  readonly question: string;
}

/** The lesson and what the learner typed, trimmed; nothing for an empty question. */
export const lessonTutorRequestBody = (
  lessonId: string,
  typed: string,
): LessonTutorRequestBody | null => {
  const question = typed.trim();
  return question.length === 0 ? null : { feature: LESSON_TUTOR_FEATURE, lessonId, question };
};

export const createLiveLessonTutorTransport =
  (connection: LiveConnection) =>
  (body: LessonTutorRequestBody): Promise<GatewayResponse> =>
    postGateway(connection, {
      feature: body.feature,
      lessonId: body.lessonId,
      question: body.question,
    });

export type LessonTutorOutcome =
  | { readonly kind: 'explained'; readonly text: string }
  /** The lesson does not cover it, or the question was clinical: referred on, never answered. */
  | { readonly kind: 'not_in_lesson'; readonly text: string }
  /** About an individual patient: refused before any model. */
  | { readonly kind: 'refusal'; readonly text: string }
  /** Switched off, or no model connected -- including the stub's own placeholder text. */
  | { readonly kind: 'switched_off' }
  | { readonly kind: 'at_limit'; readonly resetsAt: string | null }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

/** The stub provider marks everything it says; that is never an explanation. */
const STUB_PREFIX = '[';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const textOf = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

export const lessonTutorOutcome = ({ status, body }: GatewayResponse): LessonTutorOutcome => {
  const record = isRecord(body) ? body : null;
  const code = record?.['code'];
  if (status === 429 && code === '45012') {
    const allowance = record?.['allowance'];
    const resetsAt = isRecord(allowance) ? allowance['resetsAt'] : null;
    return { kind: 'at_limit', resetsAt: typeof resetsAt === 'string' ? resetsAt : null };
  }
  if ((status === 503 && code === 'no_provider') || (status === 403 && code === '45011')) {
    return { kind: 'switched_off' };
  }
  if (status !== 200 || record === null) return { kind: 'error' };

  switch (record['kind']) {
    case 'explained': {
      const text = textOf(record, 'explanation');
      if (text === null) return { kind: 'error' };
      return text.startsWith(STUB_PREFIX) ? { kind: 'switched_off' } : { kind: 'explained', text };
    }
    case 'not_in_lesson': {
      const text = textOf(record, 'message');
      return text === null ? { kind: 'error' } : { kind: 'not_in_lesson', text };
    }
    case 'patient_specific': {
      const text = textOf(record, 'message');
      return text === null ? { kind: 'error' } : { kind: 'refusal', text };
    }
    default:
      return { kind: 'error' };
  }
};

export const lessonTutorOutcomeFromThrown = (error: unknown): LessonTutorOutcome =>
  error instanceof TypeError ? { kind: 'offline' } : { kind: 'error' };
