import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CourseScreen, Screen } from '@fieldforce/ui';
import type { CourseView } from '@fieldforce/ui';
import { learningEnabled } from '../../src/features';
import { appLearningBackend } from '../../src/learning/backend';
import type { LearningBackend, OutlineRows } from '../../src/learning/live';
import { courseState, failureKind, outlineSections } from '../../src/learning/view';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';

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
    };

export const Course = ({
  courseId,
  backend = appLearningBackend(),
}: {
  readonly courseId: string;
  readonly backend?: LearningBackend;
}): ReactNode => {
  const router = useRouter();
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
          if (live) setLoaded({ kind: 'loaded', course, outline });
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
            ? 'No signal, so the course was not started. Try again when you have signal.'
            : 'The server did not start this course. Try again; if it keeps happening, tell your manager.',
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
            lesson.done ? 'Finished' : 'Not finished',
            lesson.minutes === null ? null : `about ${String(lesson.minutes)} min`,
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

  return (
    <Screen scrollable>
      <CourseScreen view={viewOf()} />
    </Screen>
  );
};

export default function CourseRoute(): ReactNode {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  return learningEnabled ? <Course courseId={courseId} /> : <Redirect href="/home" />;
}
