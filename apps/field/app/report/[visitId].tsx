import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { CallReportScreen, t, useLanguage } from '@fieldforce/ui';
// FE-D4 2. The READS are converted too now: the visit and the doctor come from the pulled store,
// like every other visit screen, instead of `createClientForScenario().listVisits()/listDoctors()`
// from the mock at :4010. The WRITE was converted in MR-18.
import { createPushClient } from '../../src/sync/push-client';
import { queueUnreadable } from '../../src/sync/async-storage-store';
import { callReportQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
// MR-25 C1 asked for this on conversion: the day in the TERRITORY's zone, not a character slice of
// the ISO string (which was right only for the mock's own offset). The lint exception is gone.
import { dayMonthIn, dayMonthOfDate } from '../../src/today/territory-day';
import { loadProductChoices, toggleProduct } from '../../src/catalogue/products';
import type { ProductList } from '../../src/catalogue/products';
import { failureDetail } from '../../src/errors/plain';
import { queueOwner } from '../../src/sync/async-storage-store';
import {
  clearReportDraft,
  readReportDraft,
  writeReportDraft,
} from '../../src/capture/report-draft';
import { useBack } from '../../src/navigation/back';

/**
 * C6 — the call report binding, for one visit.
 *
 * **`productIdsDiscussed` — `BE-W175`.** Until the catalogue existed this was sent empty on
 * purpose: inventing ids would attach a report to the wrong medicine. Now the rep marks products
 * from their company's ACTIVE catalogue (`src/catalogue/products.ts`, kept on the phone for
 * offline), and only their ids are sent; the server checks each one. The rep's own words stay
 * in the summary, separate from the list. None marked is still a valid report.
 */
/**
 * `FE-W152`. What happened to the report, kept as the OUTCOME rather than as its sentence, so the
 * words are read at render in the app's current language -- a sentence put in state stays in the
 * language it was written in.
 */
type ReportOutcome = 'sent' | 'queued';

type ReportFailure =
  | { readonly kind: 'queue_unreadable' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'not_saved'; readonly error: unknown };

const outcomeText = (outcome: ReportOutcome): { title: string; detail: string } =>
  outcome === 'sent'
    ? { title: t('report.sentTitle'), detail: t('report.sentDetail') }
    : { title: t('report.savedTitle'), detail: t('report.savedDetail') };

const failureText = (failure: ReportFailure): { title: string; detail: string } => {
  switch (failure.kind) {
    case 'queue_unreadable':
      return { title: t('report.notSavedOnEitherTitle'), detail: queueUnreadable() };
    case 'refused':
      // The server's sentence, verbatim.
      return { title: t('report.refusedTitle'), detail: failure.message };
    case 'not_saved':
      return {
        title: t('report.notSavedTitle'),
        detail:
          failure.error instanceof Error
            ? `${failureDetail(failure.error)} ${t('report.keepOpen')}`
            : t('report.keepOpen'),
      };
  }
};

export default function CallReport(): ReactNode {
  useLanguage();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  // FE-D4 2. From the phone. A visit or doctor the phone does not hold leaves the heading as
  // "This visit" and the report writable, as before: the label is not worth the MR's words.
  const { store, zone } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId);
  const doctor = doctorsFromStore(store).find((candidate) => candidate.id === visit?.doctorId);
  const doctorName = doctor?.fullName ?? t('report.thisVisit');
  // W2-C A3 / `BE-W156`. Offline, `completedAt` does not exist yet -- the server has not seen the
  // check-out -- and the header read "Dr … · " with nothing after the dot. `visitDay` is the
  // SERVER's day for the visit (MR-47), already in the territory's calendar, so it can stand in.
  const dateLabel =
    visit?.completedAt != null
      ? dayMonthIn(visit.completedAt, zone)
      : visit?.visitDay != null
        ? (dayMonthOfDate(visit.visitDay) ?? '')
        : '';
  const [productList, setProductList] = useState<ProductList | null>(null);
  const [chosenProducts, setChosenProducts] = useState<readonly string[]>([]);
  useEffect(() => {
    let live = true;
    void loadProductChoices().then((list) => {
      if (live) setProductList(list);
    });
    return () => {
      live = false;
    };
  }, []);
  const productsNote =
    productList === null
      ? t('report.productsLoading')
      : productList.kind === 'cached'
        ? t('report.productsCached')
        : productList.kind === 'none'
          ? t('report.productsNone')
          : null;
  const [summary, setSummary] = useState('');
  const [objections, setObjections] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<ReportOutcome | null>(null);
  const [failure, setFailure] = useState<ReportFailure | null>(null);
  const back = useBack();

  /**
   * `FE-W190`. The draft: what the rep typed and has not sent, kept per rep and visit
   * (`src/capture/report-draft.ts`). Read once on opening; nothing is written until it has been
   * read, or an empty screen would overwrite the words it is about to restore. Restored only into
   * fields the rep has not started typing in.
   */
  const userId = queueOwner();
  const [draftRead, setDraftRead] = useState(false);
  useEffect(() => {
    let live = true;
    void readReportDraft(userId, visitId).then((draft) => {
      if (!live) return;
      if (draft !== null) {
        setSummary((current) => (current === '' ? draft.summary : current));
        setObjections((current) => (current === '' ? draft.objections : current));
        setNextStep((current) => (current === '' ? draft.nextStep : current));
        setChosenProducts((current) => (current.length === 0 ? draft.productIds : current));
      }
      setDraftRead(true);
    });
    return () => {
      live = false;
    };
  }, [userId, visitId]);
  useEffect(() => {
    // Once sent or saved to send, the outbox holds the report and the draft is gone for good.
    if (!draftRead || sentNote !== null) return;
    void writeReportDraft(userId, visitId, {
      summary,
      objections,
      nextStep,
      productIds: chosenProducts,
    });
  }, [draftRead, sentNote, userId, visitId, summary, objections, nextStep, chosenProducts]);

  const send = (): void => {
    // FE-D12 item 3. A report that was sent, or saved to send by itself, is not sent again. The
    // screen no longer offers the button; this is the same rule where the write starts.
    if (sending || sentNote !== null) return;
    setSending(true);
    setFailure(null);

    const body = {
      id: uuid.v4(),
      visitId,
      summary,
      // `BE-W175`: the ids the rep marked, nothing else. The server checks each one.
      // `FE-W190`: and only those on the list the rep can SEE -- a draft kept from an earlier
      // opening may name a product the company has since withdrawn, and a mark the rep cannot see
      // must not be sent in their name.
      productIdsDiscussed: chosenProducts.filter((id) =>
        productList === null || productList.kind === 'none'
          ? false
          : productList.products.some((product) => product.id === id),
      ),
      objectionsRaised: objections.trim() === '' ? null : objections,
      nextStep: nextStep.trim() === '' ? null : nextStep,
      // `FE-W196`. Sent for approval. Without it the server stored the report as a draft, and the
      // managers' approval queue — which lists only submitted reports — never showed it.
      status: 'submitted' as const,
    };

    /**
     * MR-18 B2/B3. Through the outbox to Supabase, like the other four.
     *
     * **This was the only write that did not queue at all** — a bare
     * `createClientForScenario().createCallReport()` straight to `:4010`. So the copy
     * below is not a wording change, it is the wording catching up with what the code now
     * does. Three outcomes, and each says something different:
     *
     *   sent    — the server answered and accepted. Only here may the app say the manager
     *             will see it.
     *   queued  — no answer. The note IS SAFE, on this phone, and will go by itself. It is
     *             NOT sent, and saying so would be the app taking credit for work it has
     *             not done.
     *   refused — the server said no. `flushOutbox` renders the reason and the remedy on
     *             the queue screen; here the MR is told it needs attention.
     *
     * **The report's status is `submitted`, said in the body (`FE-W196`).** `apply_sync_item`
     * gives a new report with no status `'draft'` on the direct-insert branch, and before
     * `FE-W196` this body named none — so every report from a phone landed as a draft and never
     * reached a manager's approval queue. The copy below still makes no claim about approval:
     * only about whether the SERVER has the report.
     */
    void sendOrQueue(() => createPushClient().createCallReport(body), callReportQueueItem(body))
      .then((outcome) => {
        if (outcome.kind === 'sent') {
          setSentNote('sent');
          // `FE-W190`. Sent: the draft has done its job.
          void clearReportDraft(userId, visitId);
          return;
        }
        if (outcome.kind === 'queued') {
          // MR-25 D1. "Report SAVED", not "Report sent". The server has not taken this and
          // the title must not say it has -- observed on the emulator with no signal, where
          // this banner read "Report sent" over a body saying it had not been sent.
          setSentNote('queued');
          // `FE-W190`. In the outbox now, which sends it by itself: the draft is not needed.
          void clearReportDraft(userId, visitId);
          return;
        }
        if (outcome.kind === 'queue_unreadable') {
          // `FE-W44`. The server did not answer AND the queue could not be read, so this
          // report is on neither. The `queued` branch above would have told them it was
          // saved on the phone; it is not, and that is the one sentence an MR acts on by
          // closing the screen.
          setFailure({ kind: 'queue_unreadable' });
          return;
        }
        setFailure({ kind: 'refused', message: outcome.message });
      })
      .catch((error: unknown) => {
        // `sendOrQueue` only rejects if the QUEUE itself could not be written, which means
        // the note is genuinely not safe anywhere. That is the one case where the MR must
        // be told to keep the screen open.
        setFailure({ kind: 'not_saved', error });
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <CallReportScreen
      onDone={() => {
        router.back();
      }}
      // `FE-W188`. Back keeps the words: they are the draft above.
      onBack={back}
      dateLabel={dateLabel}
      doctorName={doctorName}
      failure={failure === null ? null : failureText(failure)}
      objections={objections}
      onNextStepChange={setNextStep}
      onObjectionsChange={setObjections}
      onSend={send}
      onSummaryChange={setSummary}
      chosenProductIds={chosenProducts}
      onToggleProduct={(id) => {
        setChosenProducts((current) => toggleProduct(current, id));
      }}
      products={productList !== null && productList.kind !== 'none' ? productList.products : []}
      productsNote={productsNote}
      nextStep={nextStep}
      sending={sending}
      sentNote={sentNote === null ? null : outcomeText(sentNote)}
      summary={summary}
    />
  );
}
