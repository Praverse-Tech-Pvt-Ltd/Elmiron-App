import { useState } from 'react';
import type { ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
// Device-generated, for the reason the visit route gives: the contract calls `id`
// the server-side idempotency key, so a handover sent twice from a doorway with
// one bar is one handover.
import uuid from 'expo-modules-core/src/uuid';
import { SamplesScreen, t, useLanguage } from '@fieldforce/ui';
import type { SampleLine, SampleLinePatch } from '@fieldforce/ui';
import { createPushClient } from '../../src/sync/push-client';
import { queueUnreadable } from '../../src/sync/async-storage-store';
import { unavailableReason } from '../../src/capture/preconditions';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import {
  blankLine,
  capNote,
  errorsFor,
  lineError,
  sampleRequest,
  samplesDateLabel,
} from '../../src/capture/samples';
import { sampleQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { SESSION_EXPIRED, refusalTextFor, sessionExpired } from '../../src/sync/explanation';
import type { InTheMomentRefusal } from '../../src/sync/explanation';
import { notPermittedDetail } from '../../src/errors/plain';
import { useBack } from '../../src/navigation/back';

/**
 * C5 — the samples binding.
 *
 * **Every line is sent as its own request, and a line that lands stays landed.**
 * There is no batch endpoint, `samples_and_inputs` is insert-only, and the audit
 * trigger fires per row. So three items are three writes, and if the second is
 * refused the first is not rolled back — it cannot be. The screen therefore keeps
 * only what did *not* go: lines that landed are removed, lines that failed stay
 * with their reason attached, and pressing again re-sends only those. An
 * all-or-nothing retry would post the accepted line a second time under a new id,
 * which the idempotency key cannot protect against because it would be a different
 * key.
 *
 * **`FE-W152`. A line's problem is kept as what went wrong, not as its sentence** (`LineProblem`),
 * and the sentence is built at render -- so it is in the app's current language, and a language
 * change repaints it. The same for what Record says once everything landed (`saved`).
 *
 * `occurredAt` is the device clock. Unlike a check-in there is no fix to date this
 * from, and the contract pairs `occurredAt` with a server `receivedAt` exactly so
 * the two may differ.
 */
type LineProblem =
  /** It fails `lineError`; the sentence is that function's, for the line as it now reads. */
  | { readonly kind: 'invalid' }
  /** The server answered and said no about this line only. */
  | { readonly kind: 'refused'; readonly refusal: InTheMomentRefusal }
  /** `FE-W44`. On neither the server nor the phone. */
  | { readonly kind: 'queue_unreadable' };

const problemText = (line: SampleLine, problem: LineProblem): string | null =>
  problem.kind === 'invalid'
    ? lineError(line)
    : problem.kind === 'refused'
      ? refusalTextFor(problem.refusal)
      : queueUnreadable();

/** The problems with `id`'s gone; the same object when it had none, so nothing re-renders. */
const withoutLine = (
  problems: Readonly<Record<string, LineProblem>>,
  id: string,
): Readonly<Record<string, LineProblem>> =>
  id in problems
    ? Object.fromEntries(Object.entries(problems).filter(([lineId]) => lineId !== id))
    : problems;

export default function SamplesRoute(): ReactNode {
  useLanguage();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  // `FE-W188`. The screen's Back control.
  const back = useBack();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ readonly sent: number; readonly queued: number } | null>(
    null,
  );
  const [lines, setLines] = useState<readonly SampleLine[]>([blankLine('line-1')]);
  /** What is wrong with each line that has something wrong, by line id. */
  const [problems, setProblems] = useState<Readonly<Record<string, LineProblem>>>({});
  /**
   * FE-D2 6. Why the last press could not go ahead. It used to be `failure`, which replaces the
   * form, and nothing cleared it: a doctor who synced a second later still left the rep with a
   * banner and no form. It is shown above the form now, and cleared by the next press.
   */
  const [actionFailure, setActionFailure] = useState<{ title: string; detail: string } | null>(
    null,
  );

  /**
   * MR-21 B1. The visit and the doctor come from the store the pull maintains.
   *
   * **This screen read `createClientForScenario()` and looked up a SUPABASE id the mock
   * does not hold**, so `visit` was always null against real data and `record()` returned
   * on its first line — MR-19's silent tap. Converting the write without the read left a
   * screen that could not write at all.
   *
   * No `loading` state of its own any more: the provider owns it, and a second one here
   * could disagree with it.
   */
  const { store, status, failure: pullFailure } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId) ?? null;
  const doctor =
    visit === null
      ? null
      : (doctorsFromStore(store).find((candidate) => candidate.id === visit.doctorId) ?? null);
  const loading = status === 'loading';

  const changeLine = (id: string, patch: SampleLinePatch): void => {
    // An edited line's problem goes with the edit, as its `error` always did.
    setProblems((current) => withoutLine(current, id));
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        // Rebuilt field by field rather than spread, so the stale `error` is simply
        // absent from the result â€” leaving it would leave the field red under a
        // value the MR has just corrected. It cannot be spread-then-cleared:
        // `exactOptionalPropertyTypes` makes an explicit undefined a different
        // thing from an absent property.
        //
        // `??` and not `||`: an empty name and a zero quantity are values the MR
        // can legitimately be holding mid-edit, and `||` would silently discard
        // both and put the old ones back under their thumb.
        return {
          id: line.id,
          kind: patch.kind ?? line.kind,
          itemName: patch.itemName ?? line.itemName,
          quantity: patch.quantity ?? line.quantity,
          declaredValueInr: patch.declaredValueInr ?? line.declaredValueInr,
        };
      }),
    );
  };

  // A sync that was refused or unreachable is its own state. Reported through the same
  // channel as a write failure, because to the MR both mean "the screen is not current".
  // **MR-26 B3. A FAILED BACKGROUND REFRESH IS NOT "THIS SCREEN HAS NO DATA".**
  //
  // This screen reads the visit and the doctor from the PULLED STORE, which is persisted to
  // disk and survives a restart. It does no live read of its own. Yet with no signal it
  // rendered "Could not load this visit -- the app could not reach the server", while holding
  // the visit the whole time. The banner was keyed on `pullFailure` alone, so a failure in a
  // SEPARATE, CONCURRENT operation -- the background pull -- blocked a screen that had
  // everything it needed.
  //
  // That is not the honesty rule working. The honesty rule is about ASSERTING FACTS: do not
  // tell an MR the server has something it does not. It says nothing about refusing to act on
  // state the client already holds and the server already confirmed. Refusing here asserted
  // something FALSE in the other direction -- that the visit could not be loaded, when it was
  // loaded.
  //
  // So the failure is surfaced only when the screen genuinely lacks what it needs. With the
  // visit in hand the data is STALE, not absent, and staleness is the sync indicator's job --
  // it is already on Today and it does not block anything.
  //
  // `not_permitted` is deliberately NOT gated on `visit === null`. That one is a server
  // DECISION about this MR's access rather than a silence, and an MR who has lost access to a
  // visit must be told even while a cached copy sits in the store -- showing them a visit the
  // server has just refused them is the failure this screen must never have.
  const lacksWhatItNeeds = visit === null || doctor === null;
  const shownFailure =
    pullFailure === null
      ? null
      : sessionExpired(pullFailure)
        ? SESSION_EXPIRED
        : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
          ? {
              title: t('samples.noAccessTitle'),
              detail: notPermittedDetail(),
            }
          : lacksWhatItNeeds
            ? {
                title: t('samples.loadFailedTitle'),
                detail: t('samples.loadFailedDetail'),
              }
            : null;

  const record = (): void => {
    // MR-20 B2. See `preconditions.ts`: `busy` is silent on purpose, a missing visit or
    // doctor is not.
    if (busy) return;
    setActionFailure(null);
    const unavailable = unavailableReason(visit, doctor);
    if (unavailable !== null) {
      setActionFailure(unavailable);
      return;
    }
    if (visit === null || doctor === null) return;

    const errors = errorsFor(lines);
    if (Object.keys(errors).length > 0) {
      setProblems((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.keys(errors).map((id): [string, LineProblem] => [id, { kind: 'invalid' }]),
        ),
      }));
      return;
    }

    setBusy(true);
    setSaved(null);

    void (async () => {
      // MR-18 B1. Writes go through `sync_push` to Supabase, never to :4010.
      const client = createPushClient();
      // **MR-29 A3 - ALLOWLIST: a RECORD of when this device acted.**
      // `occurred_at` is when the samples were handed over. Same reasoning as `captured_at`
      // on the consent screen: offline is the case it exists for, so the handset is the only
      // possible source, and the server bounds it rather than trusting it.
      // eslint-disable-next-line no-restricted-syntax -- allowlisted above
      const occurredAt = new Date().toISOString();
      const remaining: SampleLine[] = [];
      const remainingProblems: Record<string, LineProblem> = {};
      let sent = 0;
      let queued = 0;

      for (const line of lines) {
        const body = sampleRequest({
          line,
          id: uuid.v4(),
          visitId: visit.id,
          doctorId: doctor.id,
          occurredAt,
        });

        const outcome = await sendOrQueue(
          () => client.createSampleAndInput(body),
          sampleQueueItem(body),
        );

        if (outcome.kind === 'refused') {
          // The server answered and said no about this line only. It stays on screen
          // carrying the remedy and the server's own figures.
          //
          // **BE-W97, and this is the line MR-27 C2 stopped at.** It was
          // `error: outcome.message`, so a real `45004` read "this would put MR27 UCPMP c
          // over the UCPMP cap for 83aa5660-470b-4c82-aa90-000b5347cb1c this month" -- a
          // doctor UUID and no numbers -- while the cap, the month-to-date total, this
          // entry and the period all sat in a DETAIL that `sync_push` discarded.
          remaining.push(line);
          remainingProblems[line.id] = { kind: 'refused', refusal: outcome };
          continue;
        }
        if (outcome.kind === 'queue_unreadable') {
          // `FE-W44`. Counting this as `sent` is what the `else` did, and it would have
          // told the MR their samples were recorded when they are on neither the server
          // nor the phone. It stays on screen with the line still in it.
          remaining.push(line);
          remainingProblems[line.id] = { kind: 'queue_unreadable' };
          continue;
        }
        if (outcome.kind === 'queued') queued += 1;
        else sent += 1;
      }

      setBusy(false);

      if (remaining.length > 0) {
        setLines(remaining);
        setProblems(remainingProblems);
        setSaved(null);
        return;
      }

      setLines([blankLine(uuid.v4())]);
      setProblems({});
      setSaved({ sent, queued });
    })();
  };

  return (
    <SamplesScreen
      onDone={() => {
        router.back();
      }}
      onBack={back}
      busy={busy}
      capNote={capNote()}
      dateLabel={
        // MR-24 DEFECT 6, fixed. TWO bugs in one expression. `visits.received_at` is
        // server bookkeeping -- when the ROW ARRIVED -- not when the visit is; it headed a
        // visit scheduled 11 September as "10 Sep", because that is when `seed:day`
        // inserted it. And `dayMonthFrom` sliced the UTC day out of the ISO string.
        //
        // `scheduledFor` is the visit's own date, and `dayMonthIn` reads it in the
        // territory's zone. An MR confirming what they handed over at THIS visit, on a
        // record that is UCPMP-relevant, gets the visit's date.
        //
        // MR-49 B -- CORRECTED. The schedule is not the day the samples are handed over: a
        // visit scheduled 30 September and happening on 1 October read "30 Sep". The label
        // is now the server's day for the visit (`visitDay`, `visit_day()`). See
        // `samplesDateLabel`.
        samplesDateLabel(visit)
      }
      doctorName={doctor?.fullName ?? t('samples.thisVisit')}
      failure={shownFailure}
      actionFailure={actionFailure}
      lines={lines.map((line) => {
        const problem = problems[line.id];
        const error = problem === undefined ? null : problemText(line, problem);
        return error === null ? line : { ...line, error };
      })}
      loading={loading}
      onAddLine={() => {
        setLines((current) => [...current, blankLine(uuid.v4())]);
      }}
      onChangeLine={changeLine}
      onRecord={record}
      onRemoveLine={(id) => {
        setLines((current) => current.filter((line) => line.id !== id));
        setProblems((current) => withoutLine(current, id));
      }}
      saved={
        saved === null
          ? null
          : saved.queued === 0
            ? t('samples.recordedDetail', { n: saved.sent })
            : t('samples.queuedDetail', { n: saved.queued })
      }
    />
  );
}
