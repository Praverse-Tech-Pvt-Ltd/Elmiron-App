import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { BodyText, Heading, ListRow, Screen, TodayScreen } from '@fieldforce/ui';
import { useSession } from '../../src/session';
import { loadQueueState } from '../../src/sync/async-storage-store';
import { indicatorStateFor } from '../../src/sync/indicator';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { emptyQueue } from '../../src/sync/reducer';
import type { SyncQueueState } from '../../src/sync/reducer';
import { summariseDay } from '../../src/today/plan';
import { clockIn } from '../../src/today/territory-day';

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
  const [queue, setQueue] = useState<SyncQueueState>(emptyQueue);
  // MR-14 B2/B3. The day comes from the store the pull maintains, not from
  // `createClientForScenario()`. This line is the read conversion.
  const { store, status, notice, failure: pullFailure, removals, zone, today } = usePulledStore();

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

  // B5. `done` and `notMet` are the SERVER's visit statuses, carried through
  // `summariseDay` unchanged. An MR who found three doctors unavailable reads three
  // not-met and no congratulation -- the count is attendance, never a score.
  // A2. `today` is the server's instant in the territory's zone. Until it arrives there
  // is no day to summarise, and the handset must not supply one -- so the screen shows
  // its loading state rather than a day computed from the wrong clock.
  const summary =
    today === null
      ? null
      : summariseDay(visitsFromStore(store), doctorsFromStore(store), today, zone);
  const startedAt = summary?.startedAt ?? null;
  const next = summary?.next ?? null;

  // B6 and B8, through one channel. `notice` is null on an ordinary sync and the
  // removals list is empty, so this is an empty array and TodayScreen renders nothing
  // -- the silence B6 requires, asserted rather than assumed.
  const notices = [
    ...(notice === null ? [] : [{ title: notice.title, body: notice.body }]),
    // B8. `removalWording` says "no longer yours" for out_of_scope and never
    // "deleted" -- false for a reassignment, and dangerously so for consent.
    ...removals.map((removal) => ({
      title:
        removal.reason === 'out_of_scope' ? 'One of your records moved' : 'A record was removed',
      body: removal.message,
    })),
  ];

  // A refusal is its own state, never an empty day. An empty day and a refused one
  // look identical to an MR, and only one of them means they can stop working.
  // **MR-26 B4. A failed refresh is not an empty day.** Third instance of this, and the one
  // that matters most, because Today is where an MR starts.
  //
  // The banner was keyed on `pullFailure` alone, so a refresh failing hid a day the app
  // already had. The case that matters is the ordinary one: an MR working with the app open
  // walks into a basement, the next background pull fails, and the day they were reading
  // vanishes underneath them. With visits in the store the day is STALE, not absent, and
  // staleness is the sync indicator's job -- it is already on this screen and hides nothing.
  //
  // **What this deliberately does NOT change, because it must not: a COLD START offline.**
  // `today` comes from the pull's `serverTime` and is not persisted, so after a restart with
  // no signal `summary` is null and this banner still fires. That is CORRECT. MR-15 A2's rule
  // is that the territory's day comes from the SERVER's clock, never the handset's -- an app
  // that guessed the date from the device would put visits on the wrong day, which is the
  // defect `territory-day.ts` exists to prevent. With no server clock the app does not know
  // what day it is, and saying so is the only honest answer.
  //
  // That leaves a real gap -- an MR who cold-starts in a basement sees no day at all -- and it
  // is registered as FE-W40 rather than closed here, because closing it means deciding whether
  // a persisted `serverTime` plus elapsed time is an acceptable substitute for asking, and that
  // trades against the exact rule above.
  //
  // `not_permitted` stays unconditional. That is a server DECISION about this MR's access,
  // not a silence, and it must be shown even over a cached plan.
  const nothingToShow = summary === null;
  const failure =
    pullFailure === null
      ? null
      : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
        ? {
            title: 'You do not have access to this plan',
            detail: 'The server refused this request for your account.',
          }
        : nothingToShow
          ? {
              title: 'Could not load your day',
              detail:
                pullFailure.kind === 'refused'
                  ? `The server refused this sync (${pullFailure.refusal.sqlState}).`
                  : 'The app could not reach the server. It will try again when you come back to it.',
            }
          : null;

  return (
    <TodayScreen
      dayLabel="Today"
      startedLabel={startedAt === null ? null : `Started ${clockIn(startedAt, zone)}`}
      planned={summary?.planned ?? 0}
      done={summary?.done ?? 0}
      notMet={summary?.notMet ?? 0}
      next={
        next === null
          ? null
          : {
              doctorName: next.doctorName,
              clinic: next.clinic,
              // B4. "Not arrived yet" is not the same as "there is none".
              clinicPending: next.clinicPending,
              scheduledLabel:
                next.scheduledFor === null ? null : `Scheduled ${clockIn(next.scheduledFor, zone)}`,
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
      loading={status === 'loading' || today === null}
      failure={failure}
      notices={notices}
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
