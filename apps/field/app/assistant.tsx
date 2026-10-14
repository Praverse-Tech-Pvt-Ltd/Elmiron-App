import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { AssistantScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import type { AiAllowanceState, AssistantNotice, AssistantTurn } from '@fieldforce/ui';
import { outcomeFromGateway, outcomeFromThrown } from '../src/assistant/outcome';
import type { AssistantOutcome } from '../src/assistant/outcome';
import { chatRequestBody } from '../src/assistant/request';
import type { ChatRequestBody } from '../src/assistant/contract';
import { assistantTransport } from '../src/assistant/transport';
import { assistantEnabled } from '../src/features';
import { usePulledStore } from '../src/sync/pulled-store';
import { clockIn, dayMonthIn } from '../src/today/territory-day';
import type { TerritoryZone } from '../src/today/territory-day';

/**
 * FE-D15 — the assistant route.
 *
 * **The real `ai-gateway`, behind `assistantEnabled` (off by default)** — W2-G A switched it from the
 * sample fixture. Off, a deep link goes to Today and Me shows no row. A stub-marked reply is shown as
 * "not available yet", never as an answer (`outcomeFromGateway`).
 *
 * **What is sent is what the rep typed, and nothing else.** `chatRequestBody` takes a string. This
 * route reads the pulled store only for the territory zone, to show the server's reset time, and
 * passes nothing from it into a request.
 *
 * **Nothing here writes a reply.** The screen shows the server's answer or refusal text, or its
 * own fixed copy for a state. A reset time is shown only if the server sent one.
 */
type NoticeKind = 'none' | 'not_available' | 'offline' | 'error';

const resetLabel = (resetsAt: string | null, zone: TerritoryZone): string | null =>
  resetsAt === null
    ? null
    : t('ai.resetLabel', { time: clockIn(resetsAt, zone), date: dayMonthIn(resetsAt, zone) });

/**
 * The allowance as the server reported it. The reset INSTANT is kept, not its words, so the label
 * is written at render, in the language the app is in then.
 */
type AllowanceSeen =
  | { readonly kind: 'not_reported' }
  | {
      readonly kind: 'warning';
      readonly used: number;
      readonly limit: number;
      readonly resetsAt: string | null;
    }
  | { readonly kind: 'at_limit'; readonly resetsAt: string | null };

const allowanceView = (seen: AllowanceSeen, zone: TerritoryZone): AiAllowanceState => {
  switch (seen.kind) {
    case 'not_reported':
      return seen;
    case 'warning':
      return {
        kind: 'warning',
        used: seen.used,
        limit: seen.limit,
        resetLabel: resetLabel(seen.resetsAt, zone),
      };
    case 'at_limit':
      return { kind: 'at_limit', resetLabel: resetLabel(seen.resetsAt, zone) };
  }
};

const Assistant = (): ReactNode => {
  useLanguage();
  const { zone } = usePulledStore();
  const [turns, setTurns] = useState<readonly AssistantTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<NoticeKind>('none');
  const [seen, setSeen] = useState<AllowanceSeen>({ kind: 'not_reported' });
  /** The request that did not get an answer, kept so a retry sends exactly it again. */
  const [unanswered, setUnanswered] = useState<ChatRequestBody | null>(null);
  const nextId = useRef(0);
  const allowance = allowanceView(seen, zone);

  const id = (): string => {
    nextId.current += 1;
    return `turn-${String(nextId.current)}`;
  };

  const apply = (body: ChatRequestBody, outcome: AssistantOutcome): void => {
    switch (outcome.kind) {
      case 'answer':
      case 'refusal':
        setTurns((current) => [...current, { id: id(), kind: outcome.kind, text: outcome.text }]);
        setSeen(outcome.allowance);
        setUnanswered(null);
        setNotice('none');
        return;
      case 'at_limit':
        setSeen({ kind: 'at_limit', resetsAt: outcome.resetsAt });
        setUnanswered(null);
        setNotice('none');
        return;
      case 'not_available':
        setUnanswered(null);
        setNotice('not_available');
        return;
      case 'offline':
      case 'error':
        setUnanswered(body);
        setNotice(outcome.kind);
        return;
    }
  };

  const send = (body: ChatRequestBody): void => {
    setSending(true);
    setNotice('none');
    void assistantTransport(body)
      .then(outcomeFromGateway, outcomeFromThrown)
      .then((outcome) => {
        apply(body, outcome);
      })
      .finally(() => {
        setSending(false);
      });
  };

  const sendDraft = (): void => {
    const body = chatRequestBody(draft);
    if (body === null || sending || allowance.kind === 'at_limit') return;
    setTurns((current) => [...current, { id: id(), kind: 'question', text: body.message }]);
    setDraft('');
    send(body);
  };

  const retry = (): void => {
    if (unanswered !== null && !sending) send(unanswered);
  };

  const screenNotice: AssistantNotice =
    notice === 'offline' || notice === 'error'
      ? { kind: notice, onRetry: retry }
      : { kind: notice };

  return (
    <Screen followLatest scrollable>
      <AssistantScreen
        allowance={allowance}
        draft={draft}
        notice={screenNotice}
        onChangeDraft={setDraft}
        onSend={sendDraft}
        sample={false}
        sending={sending}
        turns={turns}
      />
    </Screen>
  );
};

export default function AssistantRoute(): ReactNode {
  return assistantEnabled ? <Assistant /> : <Redirect href="/home" />;
}
