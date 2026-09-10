import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConsentRecord } from '@fieldforce/core';
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
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
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
  /**
   * MR-21 B1. The visit and the doctor come from the store the pull maintains.
   *
   * **This screen read `createClientForScenario()` and looked up a SUPABASE id the mock
   * does not hold**, so `visit` was always null against real data and `advance()` returned
   * on its first line — MR-19's silent check-in, the defect that made G-WRITE a gate about
   * the app rather than the module.
   */
  const { store, status, failure: pullFailure } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === id) ?? null;
  const doctor =
    visit === null
      ? null
      : (doctorsFromStore(store).find((candidate) => candidate.id === visit.doctorId) ?? null);

  /**
   * **Consent records are NOT in the pull, and this is a divergence rather than an
   * oversight** — MR-21 B6.
   *
   * `sync_pull`'s own `completeness.omittedEntities` lists `consent_record` alongside the
   * other capture entities: a declared phase-2 scope. So the client cannot know this
   * doctor's consent state and this list is empty.
   *
   * What that produces is honest rather than merely convenient. `recordingBlock([])`
   * returns `never_asked`, whose wording is *"Nothing can be recorded until they have
   * answered ON THIS PHONE"* — which is exactly true of a client holding no consent record.
   * It does not claim the doctor was never asked, only that this phone has no answer.
   *
   * Recording is out of v1, needs an `uploadGrantId` only an upload session can mint
   * (FE-W29), and cannot run on Expo Go at all, so nothing reachable is lost. Registered so
   * that adding `consent_record` to the pull is a change to this comment rather than a
   * change to nothing.
   */
  const consents: readonly ConsentRecord[] = [];
  const [micGranted, setMicGranted] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  // The provider owns loading; a second flag here could disagree with it.
  const loading = status === 'loading';
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

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
        // **`!keep` is deliberate silence and stays silent.** The doctor changing their
        // mind means the audio should not exist, no row is written, and there is nothing
        // to report -- see the header above.
        if (!keep) return;

        // MR-21 A3. **The other three were merged into that guard and they are not the
        // same thing.** With `keep` true the MR has affirmatively chosen to preserve the
        // recording; returning here discarded it and said NOTHING. That is worse than the
        // null-precondition taps MR-20 fixed: those swallow an action, this swallows a
        // decision to keep something, and the MR has no reason to think anything went
        // wrong and nothing to re-do.
        //
        // Still not FILED -- a recording with no visit, no authorising consent or no start
        // time cannot be written honestly, and `recordingRequest` would refuse it anyway.
        // What changes is that the MR is told, through the same channel the `.catch` below
        // already uses for exactly this outcome.
        if (visit === null || authorising === null || startedAt === null) {
          setFailure({
            title: 'The recording was not filed',
            detail:
              'The visit or the consent it belongs to is not on this phone, so there is nothing to file it against. The audio has been discarded. Sync and record again if the doctor is still willing.',
          });
          return;
        }
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
        failure={
          failure ??
          (pullFailure === null
            ? null
            : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
              ? {
                  title: 'You do not have access to this visit',
                  detail: 'The server refused this request for your account.',
                }
              : {
                  title: 'Could not load this visit',
                  detail: 'The app could not reach the server. It will try again.',
                })
        }
        loading={loading}
        onAction={advance}
        consent={{
          /*
            MR-21 B6. `unasked` because the client HOLDS no consent record, not because it
            knows the doctor was never asked -- `sync_pull` omits `consent_record` by its
            own declaration. The three-branch mapping that stood here is gone rather than
            left unreachable: TypeScript narrowed `consent` to `never` the moment the list
            became empty, which is the compiler saying the branches cannot run. Restoring
            them is part of adding the entity to the pull, not something to keep warm.
          */
          outcome: 'unasked',
          // No answer on this phone, so no time to show. Never the device's clock.
          answeredLabel: null,
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
