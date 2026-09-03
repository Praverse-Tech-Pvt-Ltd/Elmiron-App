import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
// The idempotency key for the request, generated on the device because the
// contract says so: `id` "doubles as the server-side idempotency key", so a
// check-in sent twice from a flaky connection is one check-in. Taken from
// expo-modules-core, which is already a dependency of expo-router — adding a
// crypto package would mean another native rebuild for one function.
import uuid from 'expo-modules-core/src/uuid';
import { ApiRequestError } from '@fieldforce/core';
import type { ConsentRecord, Doctor, Visit } from '@fieldforce/core';
import { Screen, VisitScreen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { takeFix } from '../../src/capture/location';
import { actionLabelFor, blockedReason, checkInRequest, stageOf } from '../../src/capture/visit';
import { checkInQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { clockFrom } from '../../src/today/plan';

/**
 * B4 / B5 / B6 — one visit, from arriving to leaving.
 *
 * The position is read here and nowhere else, on the press, and is handed straight
 * to the request that needs it. Nothing keeps it: there is no state holding a
 * position after the request returns, which is the client half of the promise the
 * transparency screen makes.
 */
export default function VisitRoute(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async () => {
    const client = createClientForScenario();
    const [visits, doctors, consents] = await Promise.all([
      client.listVisits(),
      client.listDoctors(),
      // Settled separately: the consent ledger being unreachable must not take the
      // visit down with it. A visit whose consent state is unknown is still a visit
      // the MR has to be able to check into.
      client.listConsentRecords({ visitId: id }).catch(() => null),
    ]);
    const found = visits.items.find((candidate) => candidate.id === id) ?? null;
    setVisit(found);
    setDoctor(
      found === null
        ? null
        : (doctors.items.find((candidate) => candidate.id === found.doctorId) ?? null),
    );
    // The latest row wins, and a withdrawal is a row. `supersedesConsentRecordId`
    // means the ledger is append-only, so "what stands now" is the last thing
    // captured rather than the first — reading the earliest would show a doctor's
    // withdrawn consent as though it still held.
    setConsent(
      (consents?.items ?? [])
        .filter((record) => record.visitId === id)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .at(-1) ?? null,
    );
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure({
          title: 'Could not load this visit',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const stage = stageOf(visit);

  const advance = (): void => {
    if (visit === null || busy) return;
    setBusy(true);
    setBlocked(null);

    void (async () => {
      try {
        const outcome = await takeFix();
        const reason = blockedReason(outcome);
        if (reason !== null || outcome.kind !== 'fix') {
          setBlocked(reason);
          return;
        }

        const client = createClientForScenario();
        const body = checkInRequest({
          id: uuid.v4(),
          visitId: visit.id,
          coordinates: outcome.coordinates,
        });

        // The work goes to disk if it does not reach the server. Before this, an
        // MR who lost signal at a clinic door lost the check-in entirely — which is
        // the whole of FE-G2 and the reason the queue exists.
        const sendResult = await sendOrQueue(
          () => (stage === 'before' ? client.createCheckIn(body) : client.createCheckOut(body)),
          checkInQueueItem(body),
        );

        if (sendResult.kind === 'refused') {
          // The server answered and said no. That is a decision, shown as one.
          setFailure({ title: 'That was refused', detail: sendResult.message });
          return;
        }
        if (sendResult.kind === 'queued') {
          setBlocked(
            'Saved on this phone. It will send by itself when you have signal — nothing is lost.',
          );
          return;
        }
        await load();
      } catch (error: unknown) {
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setFailure({ title: 'That was refused', detail: error.message });
          return;
        }
        setBlocked(
          error instanceof Error
            ? `${error.message} It has not been sent yet.`
            : 'It has not been sent yet.',
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  const clinic =
    doctor?.clinicAddresses.find((address) => address.id === visit?.clinicAddressId) ??
    doctor?.clinicAddresses[0];

  return (
    <Screen scrollable>
      <VisitScreen
        actionLabel={actionLabelFor(stage)}
        blocked={blocked}
        busy={busy}
        clinic={clinic === undefined ? null : `${clinic.label}, ${clinic.city}`}
        doctorName={doctor?.fullName ?? 'This visit'}
        failure={failure}
        loading={loading}
        onAction={advance}
        consent={{
          outcome:
            consent === null || consent.isWithdrawal
              ? 'unasked'
              : consent.outcome === 'consented'
                ? 'consented'
                : consent.outcome === 'declined'
                  ? 'declined'
                  : 'unasked',
          answeredLabel: consent === null ? null : `Answered ${clockFrom(consent.capturedAt)}`,
          onAsk: () => {
            router.push(`/consent/${visit?.id ?? id}`);
          },
        }}
        onRecordSamples={() => {
          router.push(`/samples/${visit?.id ?? id}`);
        }}
        onWriteReport={() => {
          router.push(`/report/${visit?.id ?? id}`);
        }}
        stage={stage}
        startedLabel={visit?.startedAt == null ? null : `Checked in ${clockFrom(visit.startedAt)}`}
      />
    </Screen>
  );
}
