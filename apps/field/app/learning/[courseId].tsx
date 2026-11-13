import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CourseScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import type { CourseView } from '@fieldforce/ui';
import { learningEnabled } from '../../src/features';
import { appLearningBackend } from '../../src/learning/backend';
import type { CoursePreview, LearningBackend, OutlineRows } from '../../src/learning/live';
import {
  courseFacts,
  courseState,
  failureKind,
  outlineSections,
  previewVersionId,
  versionSummary,
} from '../../src/learning/view';
import { useBack } from '../../src/navigation/back';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';
import { durationLabel } from '../../src/today/duration';

/**
 * W2-F B — one course: start it (pinning a version), or its lessons once started. Which version is
 * offered, and when a market is named, is `courseState`'s decision, from the server's rows. The rows
 * are held as they came and the view is derived at render.
 */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: 'offline' | 'error' }
  | {
      readonly kind: 'loaded';
      readonly course: Awaited<ReturnType<LearningBackend['course']>>;
      readonly outline: OutlineRows | null;
      /** `FE-W193`. The one startable version's lesson count and length, before it is started. */
      readonly preview: CoursePreview | null;
    };

export const Course = ({
  courseId,
  backend = appLearningBackend(),
}: {
  readonly courseId: string;
  readonly backend?: LearningBackend;
}): ReactNode => {
  // `FE-W183`. The screen's own words follow the app's language; a language change repaints it.
  useLanguage();
  const router = useRouter();
  const back = useBack();
  const { zone } = usePulledStore();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // W2-G D (found on the emulator): read again every time this screen comes back into view. With a
  // one-time read, finishing a lesson and pressing Back showed "0 of 2 lessons finished" and the
  // list "Not started" for a course the server had marked finished.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      backend
        .course(courseId)
        .then(async (course) => {
          const state = courseState(courseId, course.versions, course.enrolments);
          const outline =
            state.kind === 'started'
              ? await backend.outline(state.versionId, state.enrolmentId)
              : null;
          // `FE-W193`. A preview that does not load leaves the page as it was — title and button —
          // rather than failing a course the rep can still start.
          const versionId = previewVersionId(state);
          const preview =
            versionId === null ? null : await backend.preview(versionId).catch(() => null);
          if (live) setLoaded({ kind: 'loaded', course, outline, preview });
        })
        .catch((error: unknown) => {
          if (live) setLoaded({ kind: 'failed', failure: failureKind(error) });
        });
      return () => {
        live = false;
      };
    }, [backend, courseId, attempt]),
  );

  const start = (versionId: string): void => {
    setStarting(true);
    setNotice(null);
    backend.start(versionId).then(
      () => {
        setStarting(false);
        setAttempt((n) => n + 1);
      },
      (error: unknown) => {
        setStarting(false);
        setNotice(
          failureKind(error) === 'offline'
            ? t('learning.startOffline')
            : t('learning.startRefused'),
        );
      },
    );
  };

  const viewOf = (): CourseView => {
    if (loaded.kind === 'loading') return { kind: 'loading' };
    if (loaded.kind === 'failed') {
      return {
        kind: loaded.failure,
        onRetry: () => {
          setLoaded({ kind: 'loading' });
          setAttempt((n) => n + 1);
        },
      };
    }
    const { title, versions, enrolments } = loaded.course;
    if (title === null) return { kind: 'not_found' };
    const state = courseState(courseId, versions, enrolments);
    if (state.kind === 'nothing_published') return { kind: 'nothing_published', title };
    if (state.kind === 'can_start' || loaded.outline === null) {
      return {
        kind: 'can_start',
        title,
        summary: versionSummary(versions, previewVersionId(state)),
        facts: courseFacts(loaded.preview),
        starting,
        notice,
        choices: (state.kind === 'can_start' ? state.choices : []).map((choice) => ({
          label: choice.label,
          onStart: () => {
            start(choice.versionId);
          },
        })),
      };
    }
    const outline = outlineSections(loaded.outline);
    return {
      kind: 'outline',
      title,
      done: outline.done,
      total: outline.total,
      finished: state.completedAt === null ? null : dayMonthIn(state.completedAt, zone),
      sections: outline.sections.map((section) => ({
        title: section.title,
        lessons: section.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          detail: [
            // `FE-W193`. "To do", not "Not finished": the server records a finish and nothing
            // else, so an unopened lesson and a half-read one look the same — and "Not finished"
            // told the rep they had started lessons they had never opened.
            lesson.done ? t('learning.lessonDone') : t('learning.lessonNotDone'),
            lesson.minutes === null
              ? null
              : // `FE-W198`. Hours and minutes past the hour, as the beat plan says them.
                t('learning.aboutDuration', { duration: durationLabel(lesson.minutes) }),
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
          onOpen: () => {
            router.push(`/learning/lesson/${lesson.id}?enrolment=${state.enrolmentId}`);
          },
        })),
      })),
    };
  };

  // `FE-W188`. A pushed screen draws its own way back.
  return (
    <Screen onBack={back} scrollable>
      <CourseScreen view={viewOf()} />
    </Screen>
  );
};

export default function CourseRoute(): ReactNode {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  return learningEnabled ? <Course courseId={courseId} /> : <Redirect href="/home" />;
}
