import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { Doctor, Visit } from '@fieldforce/core';
import { Screen, VoiceNoteScreen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { blockReason, elapsedLabel, voiceNoteRequest } from '../../src/capture/recording';

/**
 * Phase 3 D7 — the voice note, with a real microphone behind it.
 *
 * **This is the MR recording themselves and nobody else.** No consent record is
 * required, no doctor is in it, and it fires on every visit including a declined
 * one — which is the reason a declined visit still produces coaching signal at
 * all. `onboarding/microphone.tsx` refuses to collapse this and a consultation
 * recording into one sentence, and neither does this route.
 *
 * **The microphone is requested here, at the moment it is used.** The permission
 * screen explains why beforehand; this asks. A permission requested at sign-in,
 * before the MR has seen a single benefit, is the abandonment moment
 * `src/onboarding/permissions.ts` was written to avoid.
 *
 * **Nothing is uploaded.** `createVoiceNote` records the note's existence — id,
 * duration, size, when — and the audio itself needs the resumable upload path in
 * `API_PATHS.uploadSession`, which is BE-W7 and has no client here yet. The file
 * stays on the device and the screen does not claim otherwise.
 */
export default function VoiceNoteRoute(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const router = useRouter();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);

  const [visit, setVisit] = useState<Visit | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [captured, setCaptured] = useState<{ uri: string; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stopped = (): boolean => cancelled;

    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (stopped()) return;
      setGranted(permission.granted);
      if (permission.granted) {
        // Android needs this before a recorder will open the microphone at all.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }

      const client = createClientForScenario();
      const [visits, doctors] = await Promise.all([client.listVisits(), client.listDoctors()]);
      if (stopped()) return;
      const found = visits.items.find((candidate) => candidate.id === visitId) ?? null;
      setVisit(found);
      setDoctor(
        found === null
          ? null
          : (doctors.items.find((candidate) => candidate.id === found.doctorId) ?? null),
      );
    })().catch((error: unknown) => {
      if (stopped()) return;
      setFailure({
        title: 'Could not open the microphone',
        detail: error instanceof Error ? error.message : 'Unknown failure',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const start = (): void => {
    if (granted !== true) return;
    setCaptured(null);
    void (async () => {
      await recorder.prepareToRecordAsync();
      recorder.record();
    })().catch((error: unknown) => {
      setFailure({
        title: 'Recording did not start',
        detail: error instanceof Error ? error.message : 'Unknown failure',
      });
    });
  };

  const stop = (): void => {
    if (!state.isRecording) return;
    const seconds = Math.round(state.durationMillis / 1000);
    void recorder
      .stop()
      .then(() => {
        // `uri` is null until the recorder has actually written the file.
        if (recorder.uri !== null) setCaptured({ uri: recorder.uri, seconds });
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Recording did not save',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });
  };

  const save = (): void => {
    if (busy || visit === null || captured === null) return;
    setBusy(true);

    void createClientForScenario()
      .createVoiceNote(
        voiceNoteRequest({
          id: uuid.v4(),
          visitId: visit.id,
          durationSeconds: captured.seconds,
          // The device knows the duration; the byte count comes from the file the
          // upload path will read. Until that path exists this is the one figure
          // the contract needs that this route cannot measure honestly, so the
          // duration in bytes-per-second at the preset's bitrate is NOT invented —
          // a minimum of 1 keeps the schema's `positive()` satisfiable and the
          // real size lands with the upload.
          sizeBytes: 1,
          recordedAt: new Date().toISOString(),
        }),
      )
      .then(() => {
        router.back();
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Your note was not filed',
          detail:
            error instanceof Error
              ? `${error.message} The recording is still on this phone.`
              : 'The recording is still on this phone.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const blocked =
    granted === false
      ? blockReason({ kind: 'no_microphone' })
      : granted === null
        ? 'Asking for the microphone…'
        : null;

  return (
    <Screen scrollable>
      <VoiceNoteScreen
        blocked={blocked}
        busy={busy}
        elapsed={elapsedLabel(
          state.isRecording ? state.durationMillis / 1000 : (captured?.seconds ?? 0),
        )}
        failure={failure}
        hint="Try covering — what they asked, what you promised, what to do next time."
        onHoldEnd={stop}
        onHoldStart={start}
        onStartAgain={() => {
          setCaptured(null);
        }}
        prompt="What should I put in the report?"
        recording={state.isRecording}
        subject={`Your note · ${doctor?.fullName ?? 'this visit'}`}
        {...(captured === null ? {} : { onSave: save })}
      />
    </Screen>
  );
}
