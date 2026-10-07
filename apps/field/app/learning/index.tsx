import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { LearningListScreen, Screen } from '@fieldforce/ui';
import type { LearningListView } from '@fieldforce/ui';
import { learningEnabled } from '../../src/features';
import { appLearningBackend } from '../../src/learning/backend';
import type { LearningBackend } from '../../src/learning/live';
import { failureKind, myCourseItems } from '../../src/learning/view';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';

/**
 * W2-F B — the courses assigned to the rep, on the REAL server, behind `learningEnabled` (off).
 * The decisions are in `src/learning/view.ts`; this binds them. A backend can be injected for tests.
 *
 * The server's rows are held as they came; every line is derived from them at render, so the read is
 * keyed on nothing but the backend and a retry — never on a formatter's identity.
 */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: 'offline' | 'error' }
  | { readonly kind: 'loaded'; readonly data: Awaited<ReturnType<LearningBackend['myCourses']>> };

export const LearningList = ({
  backend = appLearningBackend(),
}: {
  readonly backend?: LearningBackend;
}): ReactNode => {
  const router = useRouter();
  const { zone } = usePulledStore();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoaded({ kind: 'loading' });
    backend.myCourses().then(
      (data) => {
        if (live) setLoaded({ kind: 'loaded', data });
      },
      (error: unknown) => {
        if (live) setLoaded({ kind: 'failed', failure: failureKind(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [backend, attempt]);

  const view: LearningListView =
    loaded.kind === 'loading'
      ? { kind: 'loading' }
      : loaded.kind === 'failed'
        ? {
            kind: loaded.failure,
            onRetry: () => {
              setAttempt((n) => n + 1);
            },
          }
        : {
            kind: 'loaded',
            courses: myCourseItems(loaded.data, (iso) => dayMonthIn(iso, zone)).map((item) => ({
              id: item.courseId,
              title: item.title,
              line: item.line,
              due: item.due,
              onOpen: () => {
                router.push(`/learning/${item.courseId}`);
              },
            })),
          };

  return (
    <Screen scrollable>
      <LearningListScreen view={view} />
    </Screen>
  );
};

export default function LearningRoute(): ReactNode {
  return learningEnabled ? <LearningList /> : <Redirect href="/home" />;
}
