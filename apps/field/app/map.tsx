import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, BodyText, Heading, ListRow, Screen, Title } from '@fieldforce/ui';
import { visitsAsWitnessed } from '../src/capture/visit';
import { mapsEnabled } from '../src/features';
import { ClinicMap } from '../src/maps/clinic-map';
import { NO_LOCATION, doctorPlaces, placeLink, todayPlaces } from '../src/maps/places';
import type { MapPlan } from '../src/maps/places';
import { usePulledStore } from '../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../src/sync/selectors';
import { beatPlanView } from '../src/today/beat-plan-view';

/**
 * `FE-W85` — the map: the rep's doctors' clinics (`/map`), or today's planned stops (`/map?show=today`),
 * from the pulled store this phone already holds. A pin opens the visit when there is one, else the
 * doctor. A clinic with no coordinates is LISTED under "No location on file", never placed.
 *
 * **Behind `EXPO_PUBLIC_MAPS`.** Off, this route goes to Today and nothing below renders -- which
 * matters, because the map SDK crashes without the key that only a maps-on build carries.
 */
export const MapScreen = ({
  plan,
  heading,
  empty,
  onOpen,
}: {
  readonly plan: MapPlan;
  readonly heading: string;
  readonly empty: string;
  readonly onOpen: (link: string) => void;
}): ReactNode => (
  <Screen scrollable>
    <Title>{heading}</Title>
    {plan.region === null ? (
      <Banner tone="info" title={empty} />
    ) : (
      <ClinicMap
        pins={plan.pins}
        region={plan.region}
        onOpen={(pin) => {
          onOpen(placeLink(pin));
        }}
      />
    )}
    {plan.missing.length === 0 ? null : (
      <>
        <Heading>{NO_LOCATION}</Heading>
        <BodyText muted>
          These clinics have no position recorded, so they are not on the map. Nothing is guessed.
        </BodyText>
        {plan.missing.map((place) => (
          <ListRow
            key={place.key}
            title={place.title}
            detail={place.detail}
            onPress={() => {
              onOpen(placeLink(place));
            }}
          />
        ))}
      </>
    )}
  </Screen>
);

export default function MapRoute(): ReactNode {
  const router = useRouter();
  const { show } = useLocalSearchParams<{ show?: string }>();
  const { store, status, today } = usePulledStore();
  if (!mapsEnabled) return <Redirect href="/home" />;

  const doctors = doctorsFromStore(store);
  const visits = visitsAsWitnessed(visitsFromStore(store), []);
  const forToday = show === 'today';

  let plan: MapPlan;
  if (forToday) {
    const view = beatPlanView({
      status,
      today,
      plans: [...store.beat_plan.values()],
      entries: [...store.beat_plan_entry.values()],
      visits,
      doctors,
    });
    plan = todayPlaces(view.kind === 'route' ? view.route.stops : [], doctors, visits);
  } else {
    plan = doctorPlaces(doctors);
  }

  return (
    <MapScreen
      plan={plan}
      heading={forToday ? 'Today on the map' : 'Your doctors on the map'}
      empty={
        status === 'loading'
          ? 'Loading…'
          : forToday
            ? 'No stop today has a location on file.'
            : 'No clinic has a location on file.'
      }
      onOpen={(link) => {
        router.push(link);
      }}
    />
  );
}
