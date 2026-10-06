import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { AdverseEventScreen, Screen } from '@fieldforce/ui';
import {
  adverseEventRequest,
  identifierNote,
  identifiersIn,
} from '../../src/capture/adverse-event';
import { createPushClient } from '../../src/sync/push-client';
import { QUEUE_UNREADABLE } from '../../src/sync/async-storage-store';
import { adverseEventQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';

/**
 * W2-C B / `BE-W159` — the rep flags a possible side effect, from the visit (`BE-C36`).
 *
 * The record says who (the signed-in rep, stamped by the server), when (this phone's moment, beside
 * the server's receipt that starts the fifteen-day statutory clock) and what they typed. Nothing
 * else: no severity, no assessment, no patient. The decisions live in `src/capture/adverse-event.ts`
 * and `AdverseEventScreen`; this file binds them, exactly as `app/report/[visitId].tsx` does.
 */
export default function AdverseEventFlag(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { store } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId);
  const doctor = doctorsFromStore(store).find((candidate) => candidate.id === visit?.doctorId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<{ title: string; detail: string } | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const withheld = identifierNote(identifiersIn(text));

  const send = (): void => {
    // Sent or saved is final for this screen: a second press would be a second statutory report.
    if (sending || outcome !== null || withheld !== null || text.trim() === '') return;
    setSending(true);
    setFailure(null);

    const body = adverseEventRequest({
      id: uuid.v4(),
      visitId,
      text,
      // MR-29 A3 ALLOWLIST: a RECORD of when this device acted -- `client_reported_at`, beside the
      // server's own `received_at`, which is the one the statutory deadline is computed from.
      // eslint-disable-next-line no-restricted-syntax -- allowlisted above
      at: new Date().toISOString(),
    });

    void sendOrQueue(
      () => createPushClient().createAdverseEventFlag(body),
      adverseEventQueueItem(body),
    )
      .then((result) => {
        if (result.kind === 'sent') {
          setOutcome({
            title: 'Flag sent',
            detail: 'The safety team has it. You do not need to do anything else.',
          });
          return;
        }
        if (result.kind === 'queued') {
          // Not "sent": the server has not taken it, and the statutory clock has not started.
          setOutcome({
            title: 'Flag saved',
            detail:
              'Saved on this phone. It will send by itself when you have signal — you do not have to write it again.',
          });
          return;
        }
        if (result.kind === 'queue_unreadable') {
          setFailure({ title: 'This was NOT saved', detail: QUEUE_UNREADABLE });
          return;
        }
        setFailure({ title: 'That was refused', detail: result.message });
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Not saved',
          detail:
            error instanceof Error
              ? `${error.message} Keep this screen open — the flag is not saved yet.`
              : 'Keep this screen open — the flag is not saved yet.',
        });
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Screen scrollable>
      <AdverseEventScreen
        doctorName={doctor?.fullName ?? 'This visit'}
        failure={failure}
        identifierNote={withheld}
        onSend={send}
        onTextChange={setText}
        outcome={outcome}
        sending={sending}
        text={text}
      />
    </Screen>
  );
}
