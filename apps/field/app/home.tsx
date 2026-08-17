import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { BodyText, Heading, ListRow, PrimaryButton, Screen } from '@fieldforce/ui';
import { useSession } from '../src/session';

/**
 * The role-aware shell. Which destinations exist depends on the role in the token.
 *
 * This is navigation, not permission. The server denies what the role may not do
 * whether or not a route is reachable — hiding a row is a courtesy to the user, and
 * if the API ever returns something this app should not show, that is a backend bug
 * to report rather than something to filter away here.
 */
const destinationsFor = (role: string): readonly { title: string; detail: string }[] => {
  const shared = [{ title: 'Doctors', detail: 'Territory list — wired to the mock' }];
  switch (role) {
    case 'mr':
      return [...shared, { title: 'My day', detail: 'Beat plan and visits — FE-W3' }];
    case 'field_manager':
      return [...shared, { title: 'Team', detail: 'Exceptions and approvals — FE-W6' }];
    default:
      return [...shared, { title: 'Administration', detail: 'Master data — FE-W6' }];
  }
};

export default function Home(): ReactNode {
  const { status, role, signOut } = useSession();
  const router = useRouter();

  if (status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <Screen scrollable>
      <Heading>Today</Heading>
      <BodyText muted>Signed in as {role ?? 'unknown role'}</BodyText>

      <ListRow
        title="Doctors"
        detail="Territory list — wired to the mock"
        onPress={() => {
          router.push('/doctors');
        }}
      />
      {destinationsFor(role ?? 'mr')
        .filter((destination) => destination.title !== 'Doctors')
        .map((destination) => (
          <ListRow key={destination.title} title={destination.title} detail={destination.detail} />
        ))}

      <PrimaryButton
        label="Sign out"
        onPress={() => {
          void signOut();
        }}
      />
    </Screen>
  );
}
