import type { GatewayResponse } from '../assistant/contract';
import type { ProductQaSource } from './contract';

/**
 * W2-C C / `BE-W160` — what the gateway's answer to a product question MEANS on the screen.
 *
 * **`no_approved_information` is not an error and not a fault.** It is the gateway saying, truthfully,
 * that the company has not loaded approved material that answers this — which with no content loaded
 * is every question. The screen says exactly that, with the server's own sentence, and tells the rep
 * where questions go in the meantime. Rendering it as "something went wrong" would teach the first
 * rep to try the screen that it is broken, which it is not.
 */
export type ProductQaOutcome =
  | { readonly kind: 'answer'; readonly text: string; readonly sources: readonly ProductQaSource[] }
  | { readonly kind: 'no_approved_information'; readonly text: string }
  /** The question was about an individual patient; refused by design before any model. */
  | { readonly kind: 'refusal'; readonly text: string }
  /** The feature is switched off on this server, or no model is connected. */
  | { readonly kind: 'switched_off' }
  | { readonly kind: 'at_limit'; readonly resetsAt: string | null }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

/** The marker the stub provider puts on everything it says — never an answer, whatever its kind. */
const STUB_PREFIX = '[';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const textOf = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const sourcesOf = (raw: unknown): ProductQaSource[] =>
  Array.isArray(raw)
    ? raw.flatMap((entry): ProductQaSource[] => {
        if (!isRecord(entry)) return [];
        const title = entry['documentTitle'];
        const version = entry['versionNumber'];
        const reference = entry['sourceReference'];
        if (
          typeof title !== 'string' ||
          typeof version !== 'number' ||
          typeof reference !== 'string'
        )
          return [];
        const heading = entry['heading'];
        return [
          {
            documentTitle: title,
            versionNumber: version,
            heading: typeof heading === 'string' ? heading : null,
            sourceReference: reference,
          },
        ];
      })
    : [];

export const productQaOutcome = ({ status, body }: GatewayResponse): ProductQaOutcome => {
  const record = isRecord(body) ? body : null;
  const code = record?.['code'];

  if (status === 429 && code === '45012') {
    // The gateway puts the reset time INSIDE `allowance` (`ai-gateway/index.ts`, the 429 branch).
    const allowance = record?.['allowance'];
    const resetsAt = isRecord(allowance) ? allowance['resetsAt'] : null;
    return { kind: 'at_limit', resetsAt: typeof resetsAt === 'string' ? resetsAt : null };
  }
  if ((status === 503 && code === 'no_provider') || (status === 403 && code === '45011')) {
    return { kind: 'switched_off' };
  }
  if (status !== 200 || record === null) return { kind: 'error' };

  switch (record['kind']) {
    case 'answered': {
      const answer = textOf(record, 'answer');
      const sources = sourcesOf(record['citations']);
      // An answer with no source is not an approved answer (`BE-C37`), and a stub's text is not one.
      if (answer === null || sources.length === 0 || answer.startsWith(STUB_PREFIX)) {
        return { kind: 'error' };
      }
      return { kind: 'answer', text: answer, sources };
    }
    case 'not_available': {
      const message = textOf(record, 'message');
      return message === null
        ? { kind: 'error' }
        : { kind: 'no_approved_information', text: message };
    }
    case 'patient_specific': {
      const message = textOf(record, 'message');
      return message === null ? { kind: 'error' } : { kind: 'refusal', text: message };
    }
    default:
      return { kind: 'error' };
  }
};

export const productQaOutcomeFromThrown = (error: unknown): ProductQaOutcome =>
  error instanceof TypeError ? { kind: 'offline' } : { kind: 'error' };
