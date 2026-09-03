import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { ApiRequestError } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { CallReportScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
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

    void createClientForScenario()
      .createCallReport({
        id: uuid.v4(),
        visitId,
        summary,
        // See the note above: no catalogue, so no ids rather than invented ones.
        productIdsDiscussed: [],
        objectionsRaised: objections.trim() === '' ? null : objections,
        nextStep: nextStep.trim() === '' ? null : nextStep,
      })
      .then(() => {
        setSentNote('Your manager sees this next time they open your visits.');
      })
      .catch((error: unknown) => {
        setFailure(
          error instanceof ApiRequestError
            ? { title: 'That was refused', detail: error.message }
            : {
                title: 'Not sent yet',
                detail:
                  error instanceof Error
                    ? `${error.message} Your words are still on this screen — try again when you have signal.`
                    : 'Your words are still on this screen — try again when you have signal.',
              },
        );
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
