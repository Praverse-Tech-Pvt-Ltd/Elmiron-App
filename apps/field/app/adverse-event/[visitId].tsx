import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { AdverseEventScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import {
  adverseEventRequest,
  identifierNote,
  identifiersIn,
} from '../../src/capture/adverse-event';
import { createPushClient } from '../../src/sync/push-client';
import { queueUnreadable } from '../../src/sync/async-storage-store';
import { adverseEventQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { failureDetail } from '../../src/errors/plain';

/**
 * W2-C B / `BE-W159` — the rep flags a possible side effect, from the visit (`BE-C36`).
 *
 * The record says who (the signed-in rep, stamped by the server), when (this phone's moment, beside
 * the server's receipt that starts the fifteen-day statutory clock) and what they typed. Nothing
 * else: no severity, no assessment, no patient. The decisions live in `src/capture/adverse-event.ts`
 * and `AdverseEventScreen`; this file binds them, exactly as `app/report/[visitId].tsx` does.
 */
/** A banner's two lines. */
interface Message {
  readonly title: string;
  readonly detail: string;
}

/**
 * `FE-W157`. A message read when it is SHOWN, not when the press happened: these sit in state until
 * the screen closes, and a language chosen in between must still reach them.
 */
const live = (title: () => string, detail: () => string): Message => ({
  get title() {
    return title();
  },
  get detail() {
    return detail();
  },
});

// FE-W157: regulated wording, English-only like consent — not in the catalogue.
// What the rep is told about their reporting obligation once the flag is sent or kept: these say
// what the report now is and that nothing more is owed, so they stay in the approved English.
const SENT_DETAIL = 'The safety team has it. You do not need to do anything else.';
// FE-W157: regulated wording, English-only like consent — not in the catalogue.
const SAVED_DETAIL =
  'Saved on this phone. It will send by itself when you have signal — you do not have to write it again.';

export default function AdverseEventFlag(): ReactNode {
  // `FE-W157`. Subscribed, so a language change repaints this screen's own lines.
  useLanguage();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { store } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId);
  const doctor = doctorsFromStore(store).find((candidate) => candidate.id === visit?.doctorId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Message | null>(null);
  const [failure, setFailure] = useState<Message | null>(null);
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
          setOutcome(
            live(
              () => t('adverse.sent'),
              () => SENT_DETAIL,
            ),
          );
          return;
        }
        if (result.kind === 'queued') {
          // Not "sent": the server has not taken it, and the statutory clock has not started.
          setOutcome(
            live(
              () => t('adverse.saved'),
              () => SAVED_DETAIL,
            ),
          );
          return;
        }
        if (result.kind === 'queue_unreadable') {
          setFailure(live(() => t('adverse.notSaved'), queueUnreadable));
          return;
        }
        // The server's reason is its own words, shown as they came.
        const { message } = result;
        setFailure(
          live(
            () => t('adverse.refused'),
            () => message,
          ),
        );
      })
      .catch((error: unknown) => {
        setFailure(
          live(
            () => t('adverse.notSavedYet'),
            () =>
              error instanceof Error
                ? `${failureDetail(error)} ${t('adverse.keepOpen')}`
                : t('adverse.keepOpen'),
          ),
        );
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Screen scrollable>
      <AdverseEventScreen
        doctorName={doctor?.fullName ?? t('adverse.thisVisit')}
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
