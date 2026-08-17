import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError } from '@fieldforce/core';
import type { Doctor } from '@fieldforce/core';
import { Banner, BodyText, Heading, ListRow, Screen, Spinner } from '@fieldforce/ui';
import { createClientForScenario } from '../src/api';

/**
 * The non-happy-path screen for FE-W1.
 *
 * It runs against the mock's `denied` scenario deliberately, so the pattern that
 * matters most is established before any feature is built on it: a
 * `permission_denied` reaches the UI as **a denial**, with its own state, and never
 * as an empty list. An empty list is what a client-side filter looks like, and the
 * client is never the thing deciding what an MR may see.
 *
 * Change the scenario to `populated` or `empty` to see the other two states; all
 * three render distinctly and none of them says "something went wrong".
 */
export default function Doctors(): ReactNode {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'loaded'; doctors: readonly Doctor[] }
    | { kind: 'denied'; message: string }
    | { kind: 'failed'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    const client = createClientForScenario('denied');
    let cancelled = false;

    void client
      .listDoctors()
      .then((page) => {
        if (!cancelled) setState({ kind: 'loaded', doctors: page.items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setState({ kind: 'denied', message: error.message });
          return;
        }
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Unknown failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen scrollable>
      <Heading>Doctors</Heading>

      {state.kind === 'loading' ? <Spinner label="Loading doctors" /> : null}

      {state.kind === 'denied' ? (
        <Banner
          tone="critical"
          title="You do not have access to this list"
          detail={state.message}
        />
      ) : null}

      {state.kind === 'failed' ? (
        <Banner tone="critical" title="Could not load doctors" detail={state.message} />
      ) : null}

      {state.kind === 'loaded' && state.doctors.length === 0 ? (
        <BodyText muted>No doctors in your territory yet.</BodyText>
      ) : null}

      {state.kind === 'loaded'
        ? state.doctors.map((doctor) => (
            // `specialty` is nullable in the contract, and `exactOptionalPropertyTypes`
            // means an explicit undefined is not the same as an absent prop.
            <ListRow
              key={doctor.id}
              title={doctor.fullName}
              {...(doctor.specialty === null ? {} : { detail: doctor.specialty })}
            />
          ))
        : null}
    </Screen>
  );
}
