import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Screen, VoiceNoteScreen } from '@fieldforce/ui';
import { blockReason, elapsedLabel } from '../../src/capture/recording';
import { discardNote, keepNote, sweepUnsaved } from '../../src/capture/voice-note-files';
import { cacheRoot, documentRoot, expoNoteFileSystem } from '../../src/capture/voice-note-fs';
import { useSession } from '../../src/session';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';

/**
 * Phase 3 D7 — the voice note, with a real microphone behind it.
 *
 * **This is the MR recording themselves and nobody else.** No consent record is
 * required, no doctor is in it, and it fires on every visit including a declined
 * one. `onboarding/microphone.tsx` refuses to collapse this and a consultation
 * recording into one sentence, and neither does this route.
 *
 * **The microphone is requested here, at the moment it is used.** The permission
 * screen explains why beforehand; this asks.
 *
 * ---
 * **MR-50 D — kept, owned, and nothing left behind (`C9`).**
 *
 * - **The visit comes from the pulled store** (`FE-W54`). This screen read the mock, so a real
 *   visit id found nothing and "Save this note" could not save. It now reads the same store as the
 *   visit screen, and says the visit is not here only once the pull has settled without it.
 * - **Save keeps the note on this phone, in the signed-in rep's folder** (`voice-note-files.ts`).
 *   It is NOT sent: there is no upload client (`FE-W29`), and the screen says so rather than
 *   "sent". The previous version posted metadata to the mock and reported a byte count the server
 *   "expected" — a server that never saw it.
 * - **Discarded audio is deleted**: "Start again", recording over an unsaved note, and leaving the
 *   screen without saving. Leftovers in the recorder's cache are swept when the screen opens.
 *   MR-47 measured on the emulator that none of this happened before.
 * ---
 */
const VISIT_NOT_HERE = {
  title: 'This note cannot be saved',
  detail:
    'This visit is not on this phone, so there is nothing to save the note against. Nothing you record here is kept.',
} as const;

const KEPT =
  'Saved on this phone, in your notes. It has not been sent — sending notes is not built into this app yet.';

export default function VoiceNoteRoute(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { store, status } = usePulledStore();

  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId) ?? null;
  const doctor =
    visit === null
      ? null
      : (doctorsFromStore(store).find((candidate) => candidate.id === visit.doctorId) ?? null);

  const [granted, setGranted] = useState<boolean | null>(null);
  const [captured, setCaptured] = useState<{ uri: string; seconds: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  /** The recorder file not yet kept — what leaving the screen must delete. */
  const unsaved = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stopped = (): boolean => cancelled;

    // Before anything records: audio nobody kept goes. A crash or a force-stop mid-recording
    // leaves the recorder's working file behind, and so did every build before MR-50.
    try {
      sweepUnsaved(expoNoteFileSystem, cacheRoot());
    } catch {
      // A sweep that cannot run leaves the files where they were; it must not stop recording.
    }

    // MR-29 B3: the microphone and the visit are separate operations with separate remedies.
    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (stopped()) return;
      setGranted(permission.granted);
      if (permission.granted) {
        // Android needs this before a recorder will open the microphone at all.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }
    })().catch((error: unknown) => {
      if (stopped()) return;
      setFailure({
        title: 'Could not open the microphone',
        detail: error instanceof Error ? error.message : 'Unknown failure',
      });
    });

    return () => {
      cancelled = true;
      // Leaving without saving: the note was not kept, so it does not stay.
      discardNote(expoNoteFileSystem, unsaved.current);
      unsaved.current = null;
    };
  }, []);

  // "Not on this phone" is a claim about the store, so only a settled pull may make it.
  const visitMissing = status !== 'loading' && visit === null;

  const forget = (): void => {
    discardNote(expoNoteFileSystem, unsaved.current);
    unsaved.current = null;
    setCaptured(null);
    setSaved(null);
  };

  const start = (): void => {
    if (granted !== true) return;
    // Recording over an unsaved note replaces it; the old audio goes first.
    forget();
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
        if (recorder.uri !== null) {
          unsaved.current = recorder.uri;
          setCaptured({ uri: recorder.uri, seconds });
        }
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Recording did not save',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });
  };

  const save = (): void => {
    if (busy || captured === null) return;
    if (visit === null || userId === null) {
      setFailure(VISIT_NOT_HERE);
      return;
    }
    setBusy(true);
    void keepNote(expoNoteFileSystem, documentRoot(), userId, captured.uri, uuid.v4())
      .then(() => {
        // Kept: leaving the screen must no longer delete it.
        unsaved.current = null;
        setSaved(KEPT);
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Your note was not saved',
          detail: error instanceof Error ? error.message : 'Unknown failure',
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
        failure={failure ?? (visitMissing ? VISIT_NOT_HERE : null)}
        hint="Try covering — what they asked, what you promised, what to do next time."
        onHoldEnd={stop}
        onHoldStart={start}
        onStartAgain={forget}
        prompt="What should I put in the report?"
        recording={state.isRecording}
        saved={saved}
        subject={`Your note · ${doctor?.fullName ?? 'this visit'}`}
        {...(captured === null || saved !== null ? {} : { onSave: save })}
      />
    </Screen>
  );
}
