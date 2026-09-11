import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { BodyText } from '@fieldforce/ui';
import type { ReactNode } from 'react';

/**
 * MR-14 B1/B6/B7 — the provider, exercised for real.
 *
 * `src/routes/*.test.tsx` mock this module to test how a SCREEN presents a value. This
 * file is the other half: the real provider, with `pullOnce`, the cursor store and the
 * record store all injected, asserting the sync MECHANISM. Without this, mocking the
 * provider everywhere else would mean the provider itself was never run — which is the
 * characteristic defect of this codebase and the exact reason `sync/pull.ts` sat complete
 * and uncalled for several sessions.
 *
 * `../session` is mocked because it imports `../supabase` and then `../config`, whose
 * `loadAppConfig` throws at module load without an `.env`. Everything else here is real.
 */
const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));

import { PulledStoreProvider, usePulledStore } from './pulled-store';
import { memoryPullCursorStore } from './pull-cursor';
import { memoryPulledStore } from './pulled-store-persistence';
import type { PullOutcome } from './pull';

const USER = '11111111-1111-4111-8111-111111111111';

/** The doctor the B3 proof turns on, in the shape the pull's mappers produce. */
const ASHA = {
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: 'Urology',
  qualification: 'MBBS',
  territoryId: '22222222-2222-4222-8222-222222222222',
  assignedMrId: null,
  isActive: true,
  createdAt: '2026-09-09T10:00:00.000+00:00',
  updatedAt: '2026-09-09T10:00:00.000+00:00',
} as const;

/** A `pulled` outcome carrying whatever changes a case needs. */
const pulled = (over: Partial<Extract<PullOutcome, { kind: 'pulled' }>> = {}): PullOutcome => ({
  kind: 'pulled',
  changes: [],
  notice: null,
  hasMore: false,
  cursor: 'cursor-1',
  resynced: false,
  serverTime: '2026-09-10T09:00:00+00:00',
  ...over,
});

/** Renders one field of the store's state, so an assertion can read it off the screen. */
const Probe = (): ReactNode => {
  const { store, status, notice, failure, resynced } = usePulledStore();
  return (
    <>
      <BodyText>{`status:${status}`}</BodyText>
      <BodyText>{`doctors:${String(store.doctor.size)}`}</BodyText>
      <BodyText>{`resynced:${String(resynced)}`}</BodyText>
      <BodyText>{`notice:${notice === null ? 'none' : notice.title}`}</BodyText>
      <BodyText>{`failure:${failure === null ? 'none' : failure.kind}`}</BodyText>
    </>
  );
};

beforeEach(() => {
  mockSession.mockReturnValue({ status: 'signed-in', session: { user: { id: USER } } });
});

describe('the provider that finally calls pull()', () => {
  it('pulls on mount and applies what the server sent', async () => {
    // FE-W36. `pullOnce` and `applyChanges` were complete, tested, and reached by nothing.
    // This is the assertion that they are now reached.
    const pull = jest.fn(async () =>
      Promise.resolve(
        pulled({
          changes: [{ kind: 'upsert', entity: 'doctor', record: ASHA }],
        }),
      ),
    );

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('doctors:1')).toBeTruthy();
    });
    expect(pull).toHaveBeenCalled();
  });

  it('walks every page while the server says there are more', async () => {
    // `hasMore` is the server's, and a client that ignored it would silently show a
    // partial day -- the worst kind of wrong, because it looks complete.
    let call = 0;
    const pull = jest.fn(async () => {
      call += 1;
      return Promise.resolve(
        pulled({
          hasMore: call === 1,
          changes: [
            {
              kind: 'upsert',
              entity: 'doctor',
              record: {
                id:
                  call === 1
                    ? '33333333-3333-4333-8333-333333333333'
                    : '44444444-4444-4444-8444-444444444444',
                fullName: `Dr Page ${String(call)}`,
                registrationNumber: null,
                specialty: 'Urology',
                qualification: 'MBBS',
                territoryId: '22222222-2222-4222-8222-222222222222',
                assignedMrId: null,
                isActive: true,
                createdAt: '2026-09-09T10:00:00.000+00:00',
                updatedAt: '2026-09-09T10:00:00.000+00:00',
              },
            },
          ],
        }),
      );
    });

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('doctors:2')).toBeTruthy();
    });
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it('surfaces a refusal as a refusal, not as an empty day', async () => {
    const pull = jest.fn(async () =>
      Promise.resolve({
        kind: 'refused',
        refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
      } as PullOutcome),
    );

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('failure:refused')).toBeTruthy();
    });
    expect(screen.getByText('status:failed')).toBeTruthy();
  });

  it('reports an unreachable server as unreachable, never as a refusal', async () => {
    // The distinction `doctors-route.test.tsx` guards, asserted at the source rather than
    // only at the screen. A thrown error is not the server saying no.
    const pull = jest.fn(async () => Promise.reject(new Error('Network request failed')));

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('failure:unreachable')).toBeTruthy();
    });
    expect(screen.queryByText('failure:refused')).toBeNull();
  });

  it('is SILENT when the server omitted nothing', async () => {
    // B6. The silence is the assertion, and it is the half that makes the notice mean
    // something: a notice on every sync is a notice nobody reads.
    const pull = jest.fn(async () => Promise.resolve(pulled()));

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('notice:none')).toBeTruthy();
    });
  });

  it('carries the completeness notice when the server sent one', async () => {
    // The positive control for the silence above. Without it, a provider that dropped
    // every notice on the floor would pass the previous case.
    const pull = jest.fn(async () =>
      Promise.resolve(
        pulled({
          notice: { title: 'Your list has been rebuilt', body: 'This was a full refresh.' },
        }),
      ),
    );

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('notice:Your list has been rebuilt')).toBeTruthy();
    });
  });

  it('reports a forced full re-sync so the screen can explain it — B7', async () => {
    // `pullOnce` clears the cursor and starts again on 45006/45005. That is only useful if
    // the fact reaches the screen: a day that silently rebuilt itself looks identical to a
    // day that did not, and the completeness notice is what tells the MR their removals
    // were not carried.
    const pull = jest.fn(async () =>
      Promise.resolve(
        pulled({
          resynced: true,
          notice: { title: 'Your list has been rebuilt', body: 'This was a full refresh.' },
        }),
      ),
    );

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={memoryPulledStore()}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('resynced:true')).toBeTruthy();
    });
  });
});

/**
 * P1 — the defect that would have shown a blank day after every restart.
 *
 * The cursor was already persisted and the RECORDS were not, so a restart loaded a valid
 * cursor over an empty store, `sync_pull` correctly returned only the changes since, and
 * the MR got nothing with no error to explain it. D1 restarts the app, so this is on the
 * critical path rather than theoretical.
 */
describe('the records and the cursor move together', () => {
  /**
   * ONE RENDER PER CASE. The first draft simulated the restart by rendering twice inside a
   * single test, and that broke the NEXT test in the file rather than this one — the trap
   * `home-route.test.tsx` already records in its own comment. The restart is simulated by
   * seeding the persistence a previous run would have written, which is also a cleaner
   * assertion: each case now checks one thing.
   */
  it('writes what it pulled to disk, so a restart has something to restore', async () => {
    const persistence = memoryPulledStore();
    const pull = jest.fn(async () =>
      Promise.resolve(pulled({ changes: [{ kind: 'upsert', entity: 'doctor', record: ASHA }] })),
    );

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={persistence}
        pull={pull as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('doctors:1')).toBeTruthy();
    });
    // The half that matters after the process dies: it reached disk, not just state.
    const onDisk = await persistence.load(USER);
    expect(onDisk?.doctor.get(ASHA.id)?.fullName).toBe('Dr Asha Deshpande');
  });

  it('restores those records on the next launch, when the server sends nothing new', async () => {
    // The defect this whole file exists for. A restart loaded a valid cursor over an empty
    // store, so `sync_pull` correctly returned nothing and the MR got a blank day with no
    // error. Before the persistence layer this rendered `doctors:0`.
    const persistence = memoryPulledStore();
    const cursors = memoryPullCursorStore();
    await persistence.save(USER, {
      visit: new Map(),
      doctor: new Map([[ASHA.id, ASHA]]),
      beat_plan: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
    });
    await cursors.save(USER, 'cursor-from-the-previous-run');

    const pull = jest.fn(async () => Promise.resolve(pulled({ changes: [] })));
    await render(
      <PulledStoreProvider cursors={cursors} persistence={persistence} pull={pull as never}>
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('doctors:1')).toBeTruthy();
    });
    // And the cursor was KEPT, because the records were there. The next case is the
    // opposite half.
    expect(await cursors.load(USER)).toBe('cursor-from-the-previous-run');
  });

  it('clears the cursor when the records could not be restored', async () => {
    // The other half of the invariant, and the one that makes it safe. A cursor without
    // its records would ask the server for a delta onto nothing. Losing the cursor is safe
    // and expensive -- a full sweep -- while keeping it is silent data loss.
    const cursors = memoryPullCursorStore();
    await cursors.save(USER, 'a-cursor-whose-records-are-gone');

    const pull = jest.fn(async () => Promise.resolve(pulled()));
    await render(
      <PulledStoreProvider cursors={cursors} persistence={memoryPulledStore()} pull={pull as never}>
        <Probe />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:ready')).toBeTruthy();
    });
    expect(await cursors.load(USER)).toBeNull();
  });
});
