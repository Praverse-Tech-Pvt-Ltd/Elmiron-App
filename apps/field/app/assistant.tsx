import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { AssistantScreen, Screen } from '@fieldforce/ui';
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
  resetsAt === null ? null : `${clockIn(resetsAt, zone)} on ${dayMonthIn(resetsAt, zone)}`;

const Assistant = (): ReactNode => {
  const { zone } = usePulledStore();
  const [turns, setTurns] = useState<readonly AssistantTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<NoticeKind>('none');
  const [allowance, setAllowance] = useState<AiAllowanceState>({ kind: 'not_reported' });
  /** The request that did not get an answer, kept so a retry sends exactly it again. */
  const [unanswered, setUnanswered] = useState<ChatRequestBody | null>(null);
  const nextId = useRef(0);

  const id = (): string => {
    nextId.current += 1;
    return `turn-${String(nextId.current)}`;
  };

  const apply = (body: ChatRequestBody, outcome: AssistantOutcome): void => {
    switch (outcome.kind) {
      case 'answer':
      case 'refusal':
        setTurns((current) => [...current, { id: id(), kind: outcome.kind, text: outcome.text }]);
        setAllowance(
          outcome.allowance.kind === 'warning'
            ? {
                kind: 'warning',
                used: outcome.allowance.used,
                limit: outcome.allowance.limit,
                resetLabel: resetLabel(outcome.allowance.resetsAt, zone),
              }
            : { kind: 'not_reported' },
        );
        setUnanswered(null);
        setNotice('none');
        return;
      case 'at_limit':
        setAllowance({ kind: 'at_limit', resetLabel: resetLabel(outcome.resetsAt, zone) });
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
    <Screen scrollable>
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
