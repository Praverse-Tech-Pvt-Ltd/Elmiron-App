import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { LessonVideoFrame } from '@fieldforce/ui';
import type { LessonVideoFrameView } from '@fieldforce/ui';
import type { LessonVideoRef } from './live';
import { failureKind } from './view';
import { playLabel, videoFailureLine, videoLengthLabel } from './lesson-video-view';

/**
 * `FE-W127` — a lesson's clip, played in the app with `expo-video`, above the lesson's text. What the
 * rep sees around the player is `@fieldforce/ui`'s `LessonVideoFrame`; this file decides WHEN.
 *
 * - **Poster first, tap to play.** Nothing streams until the rep asks for it: the clip's signed URL is
 *   requested only on the tap (`videoUrl`, as the signed-in rep — RLS decides), so a lesson opened to
 *   be read costs no video data. The poster is signed when the lesson is shown.
 * - **Native controls and fullscreen**; no picture-in-picture, no background playback (`app.json`'s
 *   `expo-video` plugin turns both off) — the clip plays while the lesson is on screen and stops with it.
 * - **No signal is neutral**: one calm line that the video needs a connection, the lesson's text still
 *   readable below it. A clip the server would not hand over, or one the player could not load, says
 *   "did not load". Both offer "Try again".
 * - **No autoplay**, and nothing animates of its own accord.
 */

type Phase =
  | { readonly kind: 'poster'; readonly posterUri: string | null }
  | { readonly kind: 'starting'; readonly posterUri: string | null }
  | { readonly kind: 'playing'; readonly uri: string }
  | {
      readonly kind: 'failed';
      readonly failure: 'offline' | 'error';
      /** Where it failed: showing the poster (retry shows it again) or starting the clip (retry plays). */
      readonly at: 'poster' | 'play';
    };

/** The playing clip. Its own component so the player exists only once the rep has pressed play. */
const Player = ({
  uri,
  lengthLabel,
  onFailed,
}: {
  readonly uri: string;
  readonly lengthLabel: string;
  readonly onFailed: () => void;
}): ReactNode => {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onFailed();
  }, [status, onFailed]);
  return (
    <LessonVideoFrame
      view={{
        kind: 'playing',
        lengthLabel,
        renderPlayer: (fill) => (
          <VideoView
            allowsPictureInPicture={false}
            contentFit="contain"
            fullscreenOptions={{ enable: true }}
            nativeControls
            player={player}
            style={fill}
          />
        ),
      }}
    />
  );
};

export const LessonVideo = ({
  video,
  videoUrl,
}: {
  readonly video: LessonVideoRef;
  /** The backend's signed-URL request, as the signed-in rep. */
  readonly videoUrl: (objectPath: string) => Promise<string>;
}): ReactNode => {
  const [phase, setPhase] = useState<Phase>({ kind: 'poster', posterUri: null });
  const [posterAttempt, setPosterAttempt] = useState(0);

  // The poster, when the lesson is shown. A refused poster is not worth a message — the frame stays
  // plain and still plays; no signal at all is said once, here, before the rep presses anything.
  useEffect(() => {
    if (video.posterPath === null) return undefined;
    let live = true;
    videoUrl(video.posterPath).then(
      (posterUri) => {
        if (live) setPhase((p) => (p.kind === 'poster' ? { kind: 'poster', posterUri } : p));
      },
      (error: unknown) => {
        if (live && failureKind(error) === 'offline')
          setPhase({ kind: 'failed', failure: 'offline', at: 'poster' });
      },
    );
    return () => {
      live = false;
    };
  }, [video.posterPath, videoUrl, posterAttempt]);

  const play = (posterUri: string | null): void => {
    setPhase({ kind: 'starting', posterUri });
    videoUrl(video.objectPath).then(
      (uri) => {
        setPhase({ kind: 'playing', uri });
      },
      (error: unknown) => {
        setPhase({ kind: 'failed', failure: failureKind(error), at: 'play' });
      },
    );
  };

  const onPlayerFailed = useCallback(() => {
    setPhase({ kind: 'failed', failure: 'error', at: 'play' });
  }, []);

  const lengthLabel = videoLengthLabel(video.durationSeconds);
  let view: LessonVideoFrameView;
  switch (phase.kind) {
    case 'playing':
      return <Player lengthLabel={lengthLabel} onFailed={onPlayerFailed} uri={phase.uri} />;
    case 'failed':
      view = {
        kind: 'failed',
        line: videoFailureLine(phase.failure),
        onRetry: () => {
          if (phase.at === 'play') {
            play(null);
            return;
          }
          setPhase({ kind: 'poster', posterUri: null });
          setPosterAttempt((n) => n + 1);
        },
      };
      break;
    case 'poster':
    case 'starting':
      view = {
        kind: 'poster',
        posterUri: phase.posterUri,
        starting: phase.kind === 'starting',
        lengthLabel,
        playLabel: playLabel(video.durationSeconds),
        onPlay: () => {
          play(phase.posterUri);
        },
      };
      break;
  }
  return <LessonVideoFrame view={view} />;
};
