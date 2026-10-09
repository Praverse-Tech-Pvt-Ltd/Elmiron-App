import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import type { CompleteLessonResponse } from '@fieldforce/core';
import { LessonScreen, Screen } from '@fieldforce/ui';
import type { LessonView } from '@fieldforce/ui';
import { learningEnabled, lessonTutorEnabled } from '../../../src/features';
import { LessonTutor } from '../../../src/learning/lesson-tutor';
import { appLearningBackend } from '../../../src/learning/backend';
import type { LearningBackend, LessonRow } from '../../../src/learning/live';
import { failureKind, finishNotice } from '../../../src/learning/view';
import { usePulledStore } from '../../../src/sync/pulled-store';
import { clockIn, dayMonthIn } from '../../../src/today/territory-day';

/**
 * W2-F B — one lesson, read in full, and "I have finished this lesson". The tick is the SERVER's
 * stamp from `complete_lesson`; with no answer, the screen says nothing was recorded.
 */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: 'offline' | 'error' }
  | { readonly kind: 'loaded'; readonly lesson: LessonRow | null };

export const Lesson = ({
  lessonId,
  enrolmentId,
  backend = appLearningBackend(),
  tutorEnabled = lessonTutorEnabled,
}: {
  readonly lessonId: string;
  readonly enrolmentId: string;
  readonly backend?: LearningBackend;
  /** The lesson tutor's switch (`EXPO_PUBLIC_LESSON_TUTOR`); injectable for tests. */
  readonly tutorEnabled?: boolean;
}): ReactNode => {
  const { zone } = usePulledStore();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<CompleteLessonResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    backend.lesson(lessonId, enrolmentId).then(
      (lesson) => {
        if (live) setLoaded({ kind: 'loaded', lesson });
      },
      (error: unknown) => {
        if (live) setLoaded({ kind: 'failed', failure: failureKind(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [backend, enrolmentId, lessonId, attempt]);

  const finish = (): void => {
    setRecording(true);
    setNotice(null);
    backend.complete(enrolmentId, lessonId).then(
      (ok) => {
        setRecording(false);
        setRecorded(ok);
        setNotice(finishNotice({ ok }));
      },
      (failed: unknown) => {
        setRecording(false);
        setNotice(finishNotice({ failed }));
      },
    );
  };

  const stamp = (iso: string): string => `${clockIn(iso, zone)} on ${dayMonthIn(iso, zone)}`;

  const view: LessonView =
    loaded.kind === 'loading'
      ? { kind: 'loading' }
      : loaded.kind === 'failed'
        ? {
            kind: loaded.failure,
            onRetry: () => {
              setLoaded({ kind: 'loading' });
              setAttempt((n) => n + 1);
            },
          }
        : loaded.lesson === null
          ? { kind: 'not_found' }
          : {
              kind: 'reading',
              title: loaded.lesson.title,
              body: loaded.lesson.body,
              minutes:
                loaded.lesson.estimatedMinutes === null
                  ? null
                  : `About ${String(loaded.lesson.estimatedMinutes)} minutes`,
              // The server's stamp: from this finish if it just came back, else from the read.
              finished:
                recorded !== null
                  ? stamp(recorded.lessonCompletedAt)
                  : loaded.lesson.completedAt === null
                    ? null
                    : stamp(loaded.lesson.completedAt),
              recording,
              onFinish: finish,
              notice,
            };

  return (
    <Screen scrollable>
      <LessonScreen view={view} />
      {tutorEnabled && loaded.kind === 'loaded' && loaded.lesson !== null ? (
        <LessonTutor lessonId={lessonId} zone={zone} />
      ) : null}
    </Screen>
  );
};

export default function LessonRoute(): ReactNode {
  const { lessonId, enrolment } = useLocalSearchParams<{ lessonId: string; enrolment: string }>();
  return learningEnabled ? (
    <Lesson enrolmentId={enrolment} lessonId={lessonId} />
  ) : (
    <Redirect href="/home" />
  );
}
