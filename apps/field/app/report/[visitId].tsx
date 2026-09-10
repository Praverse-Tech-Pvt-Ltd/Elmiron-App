import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import type { Doctor, Visit } from '@fieldforce/core';
import { CallReportScreen, Screen } from '@fieldforce/ui';
// The WRITE is converted; the READS on this screen are not. `listVisits`/`listDoctors`
// below still come from the mock, and this screen is named as such in the MR-18 C7 table.
// Part B is the write conversion, and pretending otherwise here would be the single-column
// table all over again.
import { createClientForScenario } from '../../src/api';
import { createPushClient } from '../../src/sync/push-client';
import { callReportQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { dayMonthFrom } from '../../src/doctors/profile';

/**
 * C6 — the call report binding, for one visit.
 *
 * **`productIdsDiscussed` is sent empty and that is deliberate.** The contract wants
 * product UUIDs; this app has no product catalogue, no endpoint that lists one, and
 * no way for an MR to pick from something that does not exist. Sending invented ids
 * would attach a report to the wrong medicine. What the MR discussed goes in their
 * own words in the summary until a catalogue exists.
 */
export default function CallReport(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const [doctorName, setDoctorName] = useState('This visit');
  const [dateLabel, setDateLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [objections, setObjections] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = createClientForScenario();
    void Promise.all([client.listVisits(), client.listDoctors()])
      .then(([visits, doctors]: [{ items: readonly Visit[] }, { items: readonly Doctor[] }]) => {
        if (cancelled) return;
        const visit = visits.items.find((candidate) => candidate.id === visitId);
        const doctor = doctors.items.find((candidate) => candidate.id === visit?.doctorId);
        if (doctor !== undefined) setDoctorName(doctor.fullName);
        if (visit?.completedAt != null) setDateLabel(dayMonthFrom(visit.completedAt));
      })
      .catch(() => {
        // The report is still writable without the doctor's name. Failing the whole
        // screen because a label could not be fetched would lose the MR's words.
      });
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const send = (): void => {
    if (sending) return;
    setSending(true);
    setFailure(null);

    const body = {
      id: uuid.v4(),
      visitId,
      summary,
      // See the note above: no catalogue, so no ids rather than invented ones.
      productIdsDiscussed: [],
      objectionsRaised: objections.trim() === '' ? null : objections,
      nextStep: nextStep.trim() === '' ? null : nextStep,
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
     * **Does this depend on `draft` status working?** No. `call_reports.status` has only
     * ever been `submitted` in any fixture (MR-16 B4), and nothing here writes `draft`:
     * `apply_sync_item` defaults a call report with no `supersedesCallReportId` to
     * `'draft'` on the direct-insert branch, but the copy makes no claim about the report's
     * STATUS at all — only about whether the SERVER has it. That distinction is why the
     * replacement is safe while `draft` remains unexercised.
     */
    void sendOrQueue(() => createPushClient().createCallReport(body), callReportQueueItem(body))
      .then((outcome) => {
        if (outcome.kind === 'sent') {
          setSentNote('Your manager sees this next time they open your visits.');
          return;
        }
        if (outcome.kind === 'queued') {
          setSentNote(
            'Saved on this phone. It will send by itself when you have signal — you do not have to retype it.',
          );
          return;
        }
        setFailure({ title: 'That was refused', detail: outcome.message });
      })
      .catch((error: unknown) => {
        // `sendOrQueue` only rejects if the QUEUE itself could not be written, which means
        // the note is genuinely not safe anywhere. That is the one case where the MR must
        // be told to keep the screen open.
        setFailure({
          title: 'Not saved',
          detail:
            error instanceof Error
              ? `${error.message} Keep this screen open — the note is not saved yet.`
              : 'Keep this screen open — the note is not saved yet.',
        });
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Screen scrollable>
      <CallReportScreen
        dateLabel={dateLabel}
        doctorName={doctorName}
        failure={failure}
        objections={objections}
        onNextStepChange={setNextStep}
        onObjectionsChange={setObjections}
        onSend={send}
        onSummaryChange={setSummary}
        nextStep={nextStep}
        sending={sending}
        sentNote={sentNote}
        summary={summary}
      />
    </Screen>
  );
}
