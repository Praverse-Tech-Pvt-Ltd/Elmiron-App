import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
// The idempotency key for the request, generated on the device because the
// contract says so: `id` "doubles as the server-side idempotency key", so a
// check-in sent twice from a flaky connection is one check-in. Taken from
// expo-modules-core, which is already a dependency of expo-router — adding a
// crypto package would mean another native rebuild for one function.
import uuid from 'expo-modules-core/src/uuid';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { ApiRequestError } from '@fieldforce/core';
import type { ConsentRecord, Doctor, Visit } from '@fieldforce/core';
import { Screen, VisitScreen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { createPushClient } from '../../src/sync/push-client';
import { takeFix } from '../../src/capture/location';
import { actionLabelFor, blockedReason, checkInRequest, stageOf } from '../../src/capture/visit';
import {
  authorisingConsent,
  blockReason,
  elapsedLabel,
  recordingBlock,
  recordingLabel,
  recordingRequest,
} from '../../src/capture/recording';
import { checkInQueueItem, checkOutQueueItem, sendOrQueue } from '../../src/sync/outbox';
import { unavailableReason } from '../../src/capture/preconditions';
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
  const [consents, setConsents] = useState<readonly ConsentRecord[]>([]);
  const [micGranted, setMicGranted] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
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
    setConsents(consents?.items ?? []);
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

  useEffect(() => {
    let cancelled = false;
    void AudioModule.getRecordingPermissionsAsync()
      .then((permission) => {
        if (!cancelled) setMicGranted(permission.granted);
      })
      .catch(() => {
        if (!cancelled) setMicGranted(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stage = stageOf(visit);

  /**
   * Whether a consultation may be recorded right now.
   *
   * The device check, which exists so the refusal happens *before* the microphone
   * opens. The server checks the same thing on `createRecording` and that is the
   * check that counts — but a recording made and then rejected is a recording that
   * existed on a phone in a doctor's room, and deleting it afterwards does not
   * undo that.
   */
  const block = recordingBlock(consents, micGranted);
  const authorising = authorisingConsent(consents);

  const startRecording = (): void => {
    if (block !== null || authorising === null) return;
    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      setMicGranted(permission.granted);
      if (!permission.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingStartedAt(new Date().toISOString());
    })().catch((error: unknown) => {
      setFailure({
        title: 'Recording did not start',
        detail: error instanceof Error ? error.message : 'Unknown failure',
      });
    });
  };

  /**
   * Stop, and either keep the recording or destroy it.
   *
   * **`keep: false` files nothing.** The doctor changing their mind means the audio
   * should not exist, so no row is written — a `recordings` row with the file
   * deleted underneath it is a record that a recording was made, which is the
   * opposite of what they asked for.
   */
  const stopRecording = (keep: boolean): void => {
    if (!recorderState.isRecording) return;
    const seconds = Math.round(recorderState.durationMillis / 1000);
    const startedAt = recordingStartedAt;
    setRecordingStartedAt(null);

    void recorder
      .stop()
      .then(async () => {
        if (!keep || visit === null || authorising === null || startedAt === null) return;
        await createClientForScenario().createRecording(
          recordingRequest({
            id: uuid.v4(),
            visitId: visit.id,
            consentRecordId: authorising.id,
            durationSeconds: seconds,
            // The preset's own bitrate, not a guess: HIGH_QUALITY is 128 kbps.
            bitrateKbps: 128,
            // Real bytes arrive with the upload, which is BE-W7 and has no client
            // here. `positive()` needs a value; this is not a measurement and the
            // upload replaces it.
            sizeBytes: 1,
            recordedAt: startedAt,
          }),
        );
      })
      .catch((error: unknown) => {
        setFailure({
          title: keep ? 'The recording was not filed' : 'Recording did not stop cleanly',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });
  };

  const advance = (): void => {
    // MR-20 B2. `busy` still returns silently -- a second tap while a request is in flight
    // is correctly ignored, because the screen is already showing a busy state. A missing
    // VISIT is different: the condition is sustained, so pressing again does nothing again,
    // and MR-19 found exactly that -- the button did nothing at all, with nothing on screen
    // and nothing on the wire.
    if (busy) return;
    const unavailable = unavailableReason(visit, doctor);
    if (unavailable !== null) {
      setFailure(unavailable);
      return;
    }
    if (visit === null) return;
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

        // MR-18 B1. Writes go through `sync_push` to Supabase, never to :4010.
        const client = createPushClient();
        const body = checkInRequest({
          id: uuid.v4(),
          visitId: visit.id,
          coordinates: outcome.coordinates,
        });

        // The work goes to disk if it does not reach the server. Before this, an
        // MR who lost signal at a clinic door lost the check-in entirely — which is
        // the whole of FE-G2 and the reason the queue exists.
        // The queue row follows the STAGE, like the call does. It did not: both stages
        // queued through `checkInQueueItem`, so a check-out taken with no signal was
        // stored as a check-in and replayed as one -- a departure recorded as an arrival.
        const sendResult = await sendOrQueue(
          () => (stage === 'before' ? client.createCheckIn(body) : client.createCheckOut(body)),
          stage === 'before' ? checkInQueueItem(body) : checkOutQueueItem(body),
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
        {...(recorderState.isRecording && authorising !== null
          ? {
              recording: {
                elapsed: elapsedLabel(recorderState.durationMillis / 1000),
                label: recordingLabel(clockFrom(authorising.capturedAt)),
                onStop: () => {
                  stopRecording(true);
                },
                onStopAndDelete: () => {
                  stopRecording(false);
                },
              },
            }
          : {})}
        onRecordVoiceNote={() => {
          router.push(`/voice-note/${visit?.id ?? id}`);
        }}
        {...(block === null && !recorderState.isRecording
          ? { onStartRecording: startRecording }
          : {})}
        recordingBlockedReason={block === null ? null : blockReason(block)}
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
