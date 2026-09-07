import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import { BodyText, Heading, ListRow, Screen, TodayScreen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { useSession } from '../../src/session';
import { loadQueueState } from '../../src/sync/async-storage-store';
import { indicatorStateFor } from '../../src/sync/indicator';
import { emptyQueue } from '../../src/sync/reducer';
import type { SyncQueueState } from '../../src/sync/reducer';
import { clockFrom, summariseDay } from '../../src/today/plan';
import type { DaySummary } from '../../src/today/plan';

/**
 * The role-aware shell. Which destinations exist depends on the role in the token.
 *
 * This is navigation, not permission. The server denies what the role may not do
 * whether or not a route is reachable — hiding a row is a courtesy to the user, and
 * if the API ever returns something this app should not show, that is a backend bug
 * to report rather than something to filter away here.
 */
const destinationsFor = (role: string): readonly { title: string; detail: string }[] => {
  switch (role) {
    case 'field_manager':
      return [{ title: 'Team', detail: 'Exceptions and approvals — FE-W6' }];
    default:
      return [{ title: 'Administration', detail: 'Master data — FE-W6' }];
  }
};

type DayState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly summary: DaySummary }
  | { readonly kind: 'failed'; readonly title: string; readonly detail: string };

/**
 * An MR's home is their day — Phase 2 B1, which replaces the "My day — FE-W3"
 * placeholder row that stood here.
 *
 * Every other role keeps the destination shell. A rep's day view is not a manager's
 * home, and rendering one for them would be a screen pretending to be about work
 * they do not do.
 */
const MrToday = (): ReactNode => {
  const router = useRouter();
  const [state, setState] = useState<DayState>({ kind: 'loading' });
  const [queue, setQueue] = useState<SyncQueueState>(emptyQueue);

  useEffect(() => {
    // B2. The queue is read on every visit to this screen rather than once, because
    // an MR who checks in offline and comes straight back here must see the item
    // waiting — a home screen that says "everything sent" over an unsent check-in
    // is the single most damaging thing this app could tell them.
    let live = true;
    void loadQueueState().then((next) => {
      if (live) setQueue(next);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void Promise.all([client.listVisits(), client.listDoctors()])
      .then(([visits, doctors]) => {
        if (!cancelled) {
          setState({ kind: 'loaded', summary: summariseDay(visits.items, doctors.items) });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A denial is its own state, never an empty day — the rule the doctors screen
        // establishes. An empty day and a forbidden day look identical to an MR, and
        // only one of them means they can stop working.
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setState({
            kind: 'failed',
            title: 'You do not have access to this plan',
            detail: error.message,
          });
          return;
        }
        setState({
          kind: 'failed',
          title: 'Could not load your day',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = state.kind === 'loaded' ? state.summary : null;
  const startedAt = summary?.startedAt ?? null;
  const next = summary?.next ?? null;

  return (
    <TodayScreen
      dayLabel="Today"
      startedLabel={startedAt === null ? null : `Started ${clockFrom(startedAt)}`}
      planned={summary?.planned ?? 0}
      done={summary?.done ?? 0}
      next={
        next === null
          ? null
          : {
              doctorName: next.doctorName,
              clinic: next.clinic,
              scheduledLabel:
                next.scheduledFor === null ? null : `Scheduled ${clockFrom(next.scheduledFor)}`,
            }
      }
      sync={indicatorStateFor(queue)}
      onOpenQueue={() => {
        router.push('/queue');
      }}
      onOpenTransparency={() => {
        router.push('/transparency');
      }}
      onFindDoctor={() => {
        router.push('/doctors');
      }}
      onOpenRoute={() => {
        router.push('/beat-plan');
      }}
      onOpenDayEnd={() => {
        router.push('/day-end');
      }}
      {...(next === null
        ? {}
        : {
            onStartNextVisit: () => {
              router.push(`/visit/${next.visitId}`);
            },
          })}
      loading={state.kind === 'loading'}
      failure={state.kind === 'failed' ? { title: state.title, detail: state.detail } : null}
    />
  );
};

export default function Home(): ReactNode {
  const { status, role } = useSession();

  if (status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <Screen scrollable>
      {role === 'mr' ? (
        <MrToday />
      ) : (
        <>
          <Heading>Today</Heading>
          <BodyText muted>Signed in as {role ?? 'unknown role'}</BodyText>
          {destinationsFor(role ?? 'mr').map((destination) => (
            <ListRow
              key={destination.title}
              title={destination.title}
              detail={destination.detail}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
