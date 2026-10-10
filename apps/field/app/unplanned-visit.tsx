import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { Banner, BodyText, Button, Label, Screen, Select, TextField, Title } from '@fieldforce/ui';
import { createPushClient } from '../src/sync/push-client';
import { QUEUE_UNREADABLE, loadQueueState } from '../src/sync/async-storage-store';
import { enqueueFirst, flushOutbox, unplannedVisitQueueItem } from '../src/sync/outbox';
import { usePulledStore } from '../src/sync/pulled-store';
import { doctorsFromStore } from '../src/sync/selectors';
import { PROBLEM_WORDS, draftProblem, unplannedVisitRequest } from '../src/visits/unplanned';

/**
 * `BE-W176` / `BE-C78` — Add an unplanned visit: doctor, clinic, reason, and straight into it.
 *
 * **Queue first, then send.** The visit is written to the phone's queue before anything else and
 * the outbox is flushed at once: with signal it is on the server within the same tap; without, it
 * waits on the phone. Either way the visit screen can open it immediately (`phoneMadeVisit`), and
 * the check-in, report and check-out that follow are queued against the same id -- the outbox holds
 * them until the visit itself is accepted.
 */
export default function UnplannedVisit(): ReactNode {
  const router = useRouter();
  const { store, refresh } = usePulledStore();
  const doctors = doctorsFromStore(store);
  const [doctorId, setDoctorId] = useState('');
  const [clinicAddressId, setClinicAddressId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  const doctor = doctors.find((d) => d.id === doctorId) ?? null;
  const draft = { doctorId, clinicAddressId, reason };
  const problem = draftProblem(draft, doctors);

  const start = (): void => {
    if (busy || problem !== null) return;
    setBusy(true);
    setFailure(null);
    // A RECORD of when the rep made this visit -- the phone is the only source, the server stores it.
    // eslint-disable-next-line no-restricted-syntax
    const body = unplannedVisitRequest(draft, uuid.v4(), new Date().toISOString());
    void (async () => {
      const queued = await enqueueFirst(unplannedVisitQueueItem(body));
      if (queued.kind === 'queue_unreadable') {
        setFailure({ title: 'This visit was NOT saved', detail: QUEUE_UNREADABLE });
        setBusy(false);
        return;
      }
      try {
        await flushOutbox(createPushClient());
      } catch {
        // No signal is not a failure here: the visit is on the phone and goes later.
      }
      const after = await loadQueueState();
      const mine =
        after.kind === 'loaded' ? after.state.items.find((item) => item.id === body.id) : undefined;
      if (mine?.status === 'failed') {
        setFailure({
          title: 'The server refused this visit',
          detail: mine.lastError ?? 'It is on the queue screen with the reason.',
        });
        setBusy(false);
        return;
      }
      refresh();
      router.replace(`/visit/${body.id}`);
    })();
  };

  return (
    <Screen scrollable>
      <Title>Add an unplanned visit</Title>
      <BodyText muted>
        For a doctor who is not on today’s plan. You do not need anyone’s approval; your manager
        sees it afterwards, with your reason.
      </BodyText>
      {failure === null ? null : (
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      )}
      {doctors.length === 0 ? (
        <Label muted>
          This phone has no doctors yet. Connect once so your doctor list arrives.
        </Label>
      ) : null}
      <Select
        label="Doctor"
        onChange={(value) => {
          setDoctorId(value);
          const chosen = doctors.find((d) => d.id === value);
          setClinicAddressId(chosen?.clinicAddresses[0]?.id ?? null);
        }}
        options={doctors.map((d) => ({ value: d.id, label: d.fullName }))}
        placeholder="Choose the doctor"
        value={doctorId}
      />
      {doctor === null || doctor.clinicAddresses.length === 0 ? null : (
        <Select
          label="Clinic"
          onChange={setClinicAddressId}
          options={doctor.clinicAddresses.map((c) => ({
            value: c.id,
            label: `${c.label}, ${c.city}`,
          }))}
          value={clinicAddressId ?? ''}
        />
      )}
      <TextField
        help="Why this visit, in a few words — for example, the doctor called you in."
        label="Reason"
        onChangeText={setReason}
        value={reason}
      />
      {problem === null ? (
        <Button label={busy ? 'Starting…' : 'Start this visit'} loading={busy} onPress={start} />
      ) : (
        <Button disabled label="Start this visit" note={PROBLEM_WORDS[problem]} onPress={start} />
      )}
    </Screen>
  );
}
