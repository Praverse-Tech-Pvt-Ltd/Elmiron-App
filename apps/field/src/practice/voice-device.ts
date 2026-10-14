import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  createAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { AudioPlayer, RecordingOptions } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { LISTEN, LISTEN_START, listenStep } from './voice';
import type { ListenState } from './voice';

/**
 * `FE-W163` — the hands-free practice loop, bound to the phone's microphone and speaker.
 *
 * Every decision is in `voice.ts`, where it is tested without a device; this file only listens,
 * records, plays and moves between the phases. It is the part that can only be proved on a handset.
 *
 * **The recording is the rep's own voice, in a practice with an AI** — never a doctor, never a visit
 * (recording consultations stays off, D-15). It is held on the phone only until it is sent, then
 * deleted; the doctor's spoken reply is deleted once it has played.
 */

/** Small and phone-friendly: mono speech at 32 kbit/s, ~240 KB a minute. */
const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32_000 },
};

export type VoicePhase =
  | 'off'
  | 'starting'
  /** The microphone is open; nobody has spoken yet. */
  | 'listening'
  /** The rep is speaking. */
  | 'hearing'
  /** Sent: the doctor is being asked. */
  | 'thinking'
  /** The doctor's reply is playing. */
  | 'speaking'
  /** Stopped for a reason the screen names; one tap carries on. */
  | 'paused';

export type VoicePause =
  | 'nothing_said'
  | 'mic_denied'
  | 'not_heard'
  | 'no_voice'
  | 'offline'
  | 'error'
  | 'interrupted'
  | 'refused'
  | 'at_limit';

/** What the screen does with a recorded turn, and what the loop does next. */
export type VoiceNext =
  | { readonly next: 'speak'; readonly audio: string }
  | { readonly next: 'listen' }
  | { readonly next: 'pause'; readonly pause: VoicePause };

export interface VoiceConversation {
  readonly phase: VoicePhase;
  readonly pause: VoicePause | null;
  /** Start, or carry on after a pause. Asks for the microphone the first time. */
  readonly start: () => void;
  /** Stop listening and stop the doctor speaking. Typing still works. */
  readonly stop: () => void;
}

export const useVoiceConversation = (
  send: (base64: string) => Promise<VoiceNext>,
): VoiceConversation => {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, LISTEN.SAMPLE_MS);
  const [phase, setPhaseState] = useState<VoicePhase>('off');
  const [pause, setPause] = useState<VoicePause | null>(null);
  const phaseRef = useRef<VoicePhase>('off');
  const listen = useRef<ListenState>(LISTEN_START);
  const player = useRef<AudioPlayer | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const setPhase = useCallback((next: VoicePhase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const releasePlayer = useCallback((): void => {
    player.current?.remove();
    player.current = null;
  }, []);

  const stopRecorder = useCallback(async (): Promise<string | null> => {
    if (!recorder.isRecording) return recorder.uri;
    await recorder.stop();
    return recorder.uri;
  }, [recorder]);

  const pauseFor = useCallback(
    (reason: VoicePause): void => {
      setPause(reason);
      setPhase('paused');
    },
    [setPhase],
  );

  const beginListening = useCallback(async (): Promise<void> => {
    releasePlayer();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    listen.current = LISTEN_START;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPause(null);
    setPhase('listening');
  }, [recorder, releasePlayer, setPhase]);

  const playReply = useCallback(
    async (base64: string): Promise<void> => {
      // Out of recording mode, so the reply plays from the loudspeaker rather than the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const file = new File(Paths.cache, 'practice-doctor-reply.mp3');
      if (file.exists) file.delete();
      file.create();
      file.write(base64, { encoding: 'base64' });
      releasePlayer();
      const reply = createAudioPlayer(file.uri);
      player.current = reply;
      setPhase('speaking');
      reply.addListener('playbackStatusUpdate', (status) => {
        if (!status.didJustFinish || player.current !== reply) return;
        releasePlayer();
        if (file.exists) file.delete();
        if (phaseRef.current === 'speaking') {
          void beginListening().catch(() => {
            pauseFor('error');
          });
        }
      });
      reply.play();
    },
    [beginListening, pauseFor, releasePlayer, setPhase],
  );

  /** The rep has finished: send the turn, then follow what the screen says comes next. */
  const finishTurn = useCallback(async (): Promise<void> => {
    setPhase('thinking');
    const uri = await stopRecorder();
    if (uri === null) {
      pauseFor('error');
      return;
    }
    const recording = new File(uri);
    let base64: string;
    try {
      base64 = await recording.base64();
    } finally {
      if (recording.exists) recording.delete();
    }
    const next = await sendRef.current(base64);
    if (phaseRef.current !== 'thinking') return; // stopped while the doctor was being asked
    if (next.next === 'speak') await playReply(next.audio);
    else if (next.next === 'listen') await beginListening();
    else pauseFor(next.pause);
  }, [beginListening, pauseFor, playReply, setPhase, stopRecorder]);

  // Each metering sample while listening: has the rep finished?
  useEffect(() => {
    if (phaseRef.current !== 'listening' && phaseRef.current !== 'hearing') return;
    if (!recorderState.isRecording) return;
    const step = listenStep(listen.current, recorderState.metering);
    listen.current = step.state;
    if (step.decision === 'send') {
      void finishTurn().catch(() => {
        pauseFor('error');
      });
    } else if (step.decision === 'nothing_said') {
      // Paused first, so the next sample cannot decide this twice; the silent recording is dropped.
      pauseFor('nothing_said');
      void stopRecorder()
        .then((uri) => {
          if (uri !== null) {
            const silent = new File(uri);
            if (silent.exists) silent.delete();
          }
        })
        .catch(() => undefined);
    } else if (step.decision === 'hearing' && phaseRef.current === 'listening') {
      setPhase('hearing');
    }
  }, [finishTurn, pauseFor, recorderState, setPhase, stopRecorder]);

  const start = useCallback((): void => {
    if (phaseRef.current !== 'off' && phaseRef.current !== 'paused') return;
    setPhase('starting');
    void AudioModule.requestRecordingPermissionsAsync()
      .then(async (permission) => {
        if (!permission.granted) {
          pauseFor('mic_denied');
          return;
        }
        await beginListening();
      })
      .catch(() => {
        pauseFor('error');
      });
  }, [beginListening, pauseFor, setPhase]);

  const stop = useCallback((): void => {
    setPause(null);
    setPhase('off');
    releasePlayer();
    void stopRecorder().catch(() => undefined);
  }, [releasePlayer, setPhase, stopRecorder]);

  // Leaving the app stops the microphone at once: nothing listens in a pocket.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      const now = phaseRef.current;
      if (now === 'off' || now === 'paused') return;
      releasePlayer();
      void stopRecorder()
        .catch(() => undefined)
        .then(() => {
          pauseFor('interrupted');
        });
    });
    return () => {
      subscription.remove();
    };
  }, [pauseFor, releasePlayer, stopRecorder]);

  // Leaving the screen stops everything.
  useEffect(
    () => () => {
      phaseRef.current = 'off';
      player.current?.remove();
      player.current = null;
    },
    [],
  );

  return { phase, pause, start, stop };
};
