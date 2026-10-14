import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import {
  Banner,
  BodyText,
  Button,
  Label,
  Screen,
  Select,
  TextField,
  Title,
  t,
  useLanguage,
} from '@fieldforce/ui';
import { createPushClient } from '../src/sync/push-client';
import { queueUnreadable, loadQueueState } from '../src/sync/async-storage-store';
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
/**
 * `FE-W154`. What went wrong, kept as a fact rather than as a sentence: a sentence held in state is
 * frozen in the language it was written in. The words are built from this at render.
 */
type Failure =
  | { readonly kind: 'not_saved' }
  | { readonly kind: 'not_accepted'; readonly lastError: string | null };

const failureWords = (failure: Failure): { title: string; detail: string } =>
  failure.kind === 'not_saved'
    ? { title: t('unplanned.notSavedTitle'), detail: queueUnreadable() }
    : {
        title: t('unplanned.notAcceptedTitle'),
        // `lastError` is the server's own words, shown as sent.
        detail: failure.lastError ?? t('unplanned.notAcceptedDetail'),
      };

export default function UnplannedVisit(): ReactNode {
  useLanguage();
  const router = useRouter();
  const { store, refresh } = usePulledStore();
  const doctors = doctorsFromStore(store);
  const [doctorId, setDoctorId] = useState('');
  const [clinicAddressId, setClinicAddressId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

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
        setFailure({ kind: 'not_saved' });
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
        setFailure({ kind: 'not_accepted', lastError: mine.lastError ?? null });
        setBusy(false);
        return;
      }
      refresh();
      router.replace(`/visit/${body.id}`);
    })();
  };

  return (
    <Screen scrollable>
      <Title>{t('unplanned.title')}</Title>
      <BodyText muted>{t('unplanned.intro')}</BodyText>
      {failure === null ? null : <Banner {...failureWords(failure)} tone="critical" />}
      {doctors.length === 0 ? <Label muted>{t('unplanned.noDoctors')}</Label> : null}
      <Select
        label={t('unplanned.doctorLabel')}
        onChange={(value) => {
          setDoctorId(value);
          const chosen = doctors.find((d) => d.id === value);
          setClinicAddressId(chosen?.clinicAddresses[0]?.id ?? null);
        }}
        options={doctors.map((d) => ({ value: d.id, label: d.fullName }))}
        placeholder={t('unplanned.doctorPlaceholder')}
        value={doctorId}
      />
      {doctor === null || doctor.clinicAddresses.length === 0 ? null : (
        <Select
          label={t('unplanned.clinicLabel')}
          onChange={setClinicAddressId}
          options={doctor.clinicAddresses.map((c) => ({
            value: c.id,
            label: `${c.label}, ${c.city}`,
          }))}
          value={clinicAddressId ?? ''}
        />
      )}
      <TextField
        help={t('unplanned.reasonHelp')}
        label={t('unplanned.reasonLabel')}
        onChangeText={setReason}
        value={reason}
      />
      {problem === null ? (
        <Button
          label={busy ? t('unplanned.starting') : t('unplanned.start')}
          loading={busy}
          onPress={start}
        />
      ) : (
        <Button
          disabled
          label={t('unplanned.start')}
          note={PROBLEM_WORDS[problem]}
          onPress={start}
        />
      )}
    </Screen>
  );
}
