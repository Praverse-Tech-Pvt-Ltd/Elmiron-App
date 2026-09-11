import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
// Device-generated, for the reason the visit route gives: the contract calls `id`
// the server-side idempotency key, so a handover sent twice from a doorway with
// one bar is one handover.
import uuid from 'expo-modules-core/src/uuid';
import { SamplesScreen, Screen } from '@fieldforce/ui';
import type { SampleLine, SampleLinePatch } from '@fieldforce/ui';
import { createPushClient } from '../../src/sync/push-client';
import { unavailableReason } from '../../src/capture/preconditions';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { blankLine, CAP_NOTE, errorsFor, sampleRequest } from '../../src/capture/samples';
import { sampleQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { dayMonthIn } from '../../src/today/territory-day';

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
 * `occurredAt` is the device clock. Unlike a check-in there is no fix to date this
 * from, and the contract pairs `occurredAt` with a server `receivedAt` exactly so
 * the two may differ.
 */
export default function SamplesRoute(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly SampleLine[]>([blankLine('line-1')]);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

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
  const { store, status, zone, failure: pullFailure } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId) ?? null;
  const doctor =
    visit === null
      ? null
      : (doctorsFromStore(store).find((candidate) => candidate.id === visit.doctorId) ?? null);
  const loading = status === 'loading';

  const changeLine = (id: string, patch: SampleLinePatch): void => {
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
    failure ??
    (pullFailure === null
      ? null
      : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
        ? {
            title: 'You do not have access to this visit',
            detail: 'The server refused this request for your account.',
          }
        : lacksWhatItNeeds
          ? {
              title: 'Could not load this visit',
              detail: 'The app could not reach the server. It will try again.',
            }
          : null);

  const record = (): void => {
    // MR-20 B2. See `preconditions.ts`: `busy` is silent on purpose, a missing visit or
    // doctor is not.
    if (busy) return;
    const unavailable = unavailableReason(visit, doctor);
    if (unavailable !== null) {
      setFailure(unavailable);
      return;
    }
    if (visit === null || doctor === null) return;

    const errors = errorsFor(lines);
    if (Object.keys(errors).length > 0) {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          ...(line.id in errors ? { error: errors[line.id] } : {}),
        })),
      );
      return;
    }

    setBusy(true);
    setSaved(null);

    void (async () => {
      // MR-18 B1. Writes go through `sync_push` to Supabase, never to :4010.
      const client = createPushClient();
      const occurredAt = new Date().toISOString();
      const remaining: SampleLine[] = [];
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
          // The server answered and said no about this line only. It stays on
          // screen carrying the server's own words.
          remaining.push({ ...line, error: outcome.message });
          continue;
        }
        if (outcome.kind === 'queued') queued += 1;
        else sent += 1;
      }

      setBusy(false);

      if (remaining.length > 0) {
        setLines(remaining);
        setSaved(null);
        return;
      }

      setLines([blankLine(uuid.v4())]);
      setSaved(
        queued === 0
          ? `${String(sent)} recorded against this visit.`
          : `${String(queued)} saved on this phone. They will send by themselves when you have signal — nothing is lost.`,
      );
    })();
  };

  return (
    <Screen scrollable>
      <SamplesScreen
        busy={busy}
        capNote={CAP_NOTE}
        dateLabel={
          // MR-24 DEFECT 6, fixed. TWO bugs in one expression. `visits.received_at` is
          // server bookkeeping -- when the ROW ARRIVED -- not when the visit is; it headed a
          // visit scheduled 11 September as "10 Sep", because that is when `seed:day`
          // inserted it. And `dayMonthFrom` sliced the UTC day out of the ISO string.
          //
          // `scheduledFor` is the visit's own date, and `dayMonthIn` reads it in the
          // territory's zone. An MR confirming what they handed over at THIS visit, on a
          // record that is UCPMP-relevant, gets the visit's date.
          visit === null ? 'today' : dayMonthIn(visit.scheduledFor ?? visit.receivedAt, zone)
        }
        doctorName={doctor?.fullName ?? 'This visit'}
        failure={shownFailure}
        lines={lines}
        loading={loading}
        onAddLine={() => {
          setLines((current) => [...current, blankLine(uuid.v4())]);
        }}
        onChangeLine={changeLine}
        onRecord={record}
        onRemoveLine={(id) => {
          setLines((current) => current.filter((line) => line.id !== id));
        }}
        saved={saved}
      />
    </Screen>
  );
}
