import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
// Device-generated, for the reason the visit route gives: the contract calls `id`
// the server-side idempotency key, so a handover sent twice from a doorway with
// one bar is one handover.
import uuid from 'expo-modules-core/src/uuid';
import { ApiRequestError } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { SamplesScreen, Screen } from '@fieldforce/ui';
import type { SampleLine, SampleLinePatch } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { createPushClient } from '../../src/sync/push-client';
import { blankLine, CAP_NOTE, errorsFor, sampleRequest } from '../../src/capture/samples';
import { sampleQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { dayMonthFrom } from '../../src/doctors/profile';

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
  const [visit, setVisit] = useState<Visit | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly SampleLine[]>([blankLine('line-1')]);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async () => {
    const client = createClientForScenario();
    const [visits, doctors] = await Promise.all([client.listVisits(), client.listDoctors()]);
    const found = visits.items.find((candidate) => candidate.id === visitId) ?? null;
    setVisit(found);
    setDoctor(
      found === null
        ? null
        : (doctors.items.find((candidate) => candidate.id === found.doctorId) ?? null),
    );
  }, [visitId]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof ApiRequestError && error.code === 'permission_denied'
            ? { title: 'You do not have access to this visit', detail: error.message }
            : {
                title: 'Could not load this visit',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              },
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const changeLine = (id: string, patch: SampleLinePatch): void => {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        // Rebuilt field by field rather than spread, so the stale `error` is simply
        // absent from the result — leaving it would leave the field red under a
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

  const record = (): void => {
    if (busy || visit === null || doctor === null) return;

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
        dateLabel={visit === null ? 'today' : dayMonthFrom(visit.receivedAt)}
        doctorName={doctor?.fullName ?? 'This visit'}
        failure={failure}
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
