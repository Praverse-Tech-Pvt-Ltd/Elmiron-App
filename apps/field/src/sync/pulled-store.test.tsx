import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BodyText, Button } from '@fieldforce/ui';
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
import { emptyStore } from './pull';
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
  const { store, status, notice, failure, resynced, serverTime, today, dayOrigin, zone, refresh } =
    usePulledStore();
  return (
    <>
      <BodyText>{`status:${status}`}</BodyText>
      {/* FE-W40. The day, where it came from, and the zone it is reckoned in. */}
      <BodyText>{`today:${today ?? 'none'}`}</BodyText>
      <BodyText>{`dayOrigin:${dayOrigin.kind}`}</BodyText>
      <BodyText>{`zone:${zone.timeZone}`}</BodyText>
      <BodyText>{`doctors:${String(store.doctor.size)}`}</BodyText>
      <BodyText>{`resynced:${String(resynced)}`}</BodyText>
      <BodyText>{`notice:${notice === null ? 'none' : notice.title}`}</BodyText>
      <BodyText>{`failure:${failure === null ? 'none' : failure.kind}`}</BodyText>
      {/* MR-28 A2. The clock the consent screen applies the activation window against. */}
      <BodyText>{`serverTime:${serverTime ?? 'none'}`}</BodyText>
      <Button variant="quiet" label="refresh" onPress={refresh} />
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

  it('EXPOSES the server’s clock, which is the only one the window may use', async () => {
    // MR-28 A2. `consent/[visitId].tsx` applied `effectiveFrom`/`effectiveUntil` against
    // `new Date()`. MR-15 A2 forbids the handset for the day boundary for the same reason,
    // and this is the same defect one screen along: a fast phone offers a notice that is
    // not yet active and `capture_consent` refuses it at 45001 with a doctor waiting.
    const pull = jest.fn(async () =>
      Promise.resolve(pulled({ serverTime: '2026-09-10T09:00:00+00:00' })),
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
      expect(screen.getByText('serverTime:2026-09-10T09:00:00+00:00')).toBeTruthy();
    });
  });

  it('HOLDS the last server clock when a later pull fails — it ages, deliberately', async () => {
    // The answer to “what happens as that value ages”, asserted rather than described.
    // A failed pull does NOT clear it, and that is the safe direction on both sides: a
    // notice scheduled for later stays withheld until a pull succeeds, and a notice
    // retired since the last pull is still re-resolved by `capture_consent`, which refuses
    // it at 45001 with its own remedy. Clearing it would blank the consent screen on every
    // transient failure, which is what MR-26 B3 removed everywhere else.
    const pull = jest
      .fn<() => Promise<PullOutcome>>()
      .mockResolvedValueOnce(pulled({ serverTime: '2026-09-10T09:00:00+00:00' }))
      .mockRejectedValueOnce(new Error('Network request failed'));

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
      expect(screen.getByText('serverTime:2026-09-10T09:00:00+00:00')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('refresh'));

    await waitFor(() => {
      expect(screen.getByText('failure:unreachable')).toBeTruthy();
    });
    // The precondition for the assertion below: the second pull really did run and really
    // did fail. Without it this passes over a refresh that never fired.
    expect(pull).toHaveBeenCalledTimes(2);
    expect(screen.getByText('serverTime:2026-09-10T09:00:00+00:00')).toBeTruthy();
    expect(screen.queryByText('serverTime:none')).toBeNull();
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

/**
 * `FE-W40` — a cold start with no signal, bounded at the territory day boundary.
 *
 * **The pair STRADDLES 18:30Z (IST midnight) rather than sitting either side of it.** One
 * anchor instant, `17:45:00Z` on the 14th — 45 minutes before the boundary — and the only
 * difference between the two cases is how much device time has elapsed since it arrived:
 * 30 minutes projects to `18:15Z` (23:45 IST, still the 14th) and 60 minutes to `18:45Z`
 * (00:15 IST, now the 15th). 15 minutes short of the boundary and 15 minutes past it.
 *
 * These run against the REAL provider with the real persistence double, so they exercise the
 * hydration ORDER as well as the arithmetic — `day-anchor.test.ts` covers the arithmetic on
 * its own.
 */
describe('FE-W40 — the day on a cold start with no signal', () => {
  const IST_ANCHOR = {
    serverTime: '2026-09-14T17:45:00.000Z',
    timeZone: 'Asia/Kolkata',
    zoneSource: 'territory',
  } as const;

  const MINUTE = 60_000;

  /** A pull that cannot reach anything — the whole point of a cold start offline. */
  const unreachable = jest.fn(async () => Promise.reject(new Error('offline')));

  const renderWith = async (persistence: ReturnType<typeof memoryPulledStore>): Promise<void> => {
    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={persistence}
        pull={unreachable as never}
      >
        <Probe />
      </PulledStoreProvider>,
    );
  };

  it('an anchor from EARLIER THE SAME territory day renders the day, marked as anchored', async () => {
    const persistence = memoryPulledStore();
    await persistence.save(USER, emptyStore());
    await persistence.saveAnchor(USER, { ...IST_ANCHOR, receivedAt: Date.now() - 30 * MINUTE });

    await renderWith(persistence);

    await waitFor(() => {
      expect(screen.getByText('today:2026-09-14')).toBeTruthy();
    });
    expect(screen.getByText('dayOrigin:anchored')).toBeTruthy();
  });

  it('an anchor from the PREVIOUS territory day renders NOTHING, and says which', async () => {
    const persistence = memoryPulledStore();
    await persistence.save(USER, emptyStore());
    // Thirty minutes later than the case above. The only difference.
    await persistence.saveAnchor(USER, { ...IST_ANCHOR, receivedAt: Date.now() - 60 * MINUTE });

    await renderWith(persistence);

    await waitFor(() => {
      expect(screen.getByText('dayOrigin:expired')).toBeTruthy();
    });
    // The invariant: `today` is null unless the origin is live or anchored.
    expect(screen.getByText('today:none')).toBeTruthy();
  });

  it("keeps the ANCHOR's zone when the zone fetch falls back to UTC", async () => {
    // `fetchTerritoryZone` never throws -- offline it answers UTC_FALLBACK, meaning "the
    // server declined to say". Overwriting the restored Asia/Kolkata with it would render
    // every clock, including the "as of" label, 5h30m wrong: the MR-14 defect inside this fix.
    const persistence = memoryPulledStore();
    await persistence.save(USER, emptyStore());
    await persistence.saveAnchor(USER, { ...IST_ANCHOR, receivedAt: Date.now() - 30 * MINUTE });

    await renderWith(persistence);

    await waitFor(() => {
      expect(screen.getByText('zone:Asia/Kolkata')).toBeTruthy();
    });
  });

  it('B3 — a store that cannot be restored takes the ANCHOR down with it', async () => {
    // An anchor outliving its records would render a real DATE over an empty store --
    // "0 of 0 visits attended" presented as the MR's plan. A false statement assembled from
    // two true ones, and the cursor-ahead-of-records failure in a new place.
    const persistence = memoryPulledStore();
    await persistence.saveAnchor(USER, { ...IST_ANCHOR, receivedAt: Date.now() - 30 * MINUTE });
    // No `save` at all: `load` answers null, exactly as a corrupt or absent store does.

    await renderWith(persistence);

    await waitFor(() => {
      expect(screen.getByText('dayOrigin:none')).toBeTruthy();
    });
    expect(screen.getByText('today:none')).toBeTruthy();
    // Asserting the CONTENT, not the screen: the anchor is gone from storage, so the next
    // cold start cannot find it either.
    expect(await persistence.loadAnchor(USER)).toBeNull();
  });

  it('B3/MR-31 — an UNUSABLE persisted timeZone must not wedge sync', async () => {
    // `"garbage"` is a non-empty string, which is all the original guard required, and
    // `Intl.DateTimeFormat` throws `RangeError: Invalid time zone specified` on it. That
    // throw happened during hydration, INSIDE the sync effect's try -- so it was reported
    // as `{ kind: 'unreachable' }` and, worse, it aborted BEFORE the pull ran. Nothing
    // rewrote the bad anchor, so every later launch did the same: sync permanently wedged,
    // and the MR told the app could not reach the server.
    const persistence = memoryPulledStore();
    await persistence.save(USER, emptyStore());
    await persistence.saveAnchor(USER, {
      ...IST_ANCHOR,
      timeZone: 'garbage',
      receivedAt: Date.now() - 30 * MINUTE,
    });

    const pull = jest.fn(async () =>
      Promise.resolve(
        pulled({
          serverTime: '2026-09-20T09:00:00+00:00',
          changes: [{ kind: 'upsert', entity: 'doctor', record: ASHA }],
        }),
      ),
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

    // The assertion that fails against the defect: the PULL RAN.
    await waitFor(() => {
      expect(screen.getByText('doctors:1')).toBeTruthy();
    });
    expect(screen.getByText('dayOrigin:live')).toBeTruthy();
    expect(screen.getByText('today:2026-09-20')).toBeTruthy();
    // And the bad anchor is REPLACED rather than left to wedge the next launch too. The
    // zone here is UTC, not Asia/Kolkata, because this test has no server for
    // `fetchTerritoryZone` to ask -- the point is that the stored anchor now PARSES, which
    // the poisoned one did not.
    const rewritten = await persistence.loadAnchor(USER);
    expect(rewritten).not.toBeNull();
    expect(rewritten?.serverTime).toBe('2026-09-20T09:00:00+00:00');
  });

  it('THE POSITIVE CONTROL: a pull that SUCCEEDS takes the day from the server, not the anchor', async () => {
    // Without this, an implementation that always preferred the anchor would satisfy every
    // case above while quietly making the app never show a live day again.
    const persistence = memoryPulledStore();
    await persistence.save(USER, emptyStore());
    await persistence.saveAnchor(USER, { ...IST_ANCHOR, receivedAt: Date.now() - 30 * MINUTE });

    const pull = jest.fn(async () =>
      Promise.resolve(pulled({ serverTime: '2026-09-20T09:00:00+00:00' })),
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
      expect(screen.getByText('dayOrigin:live')).toBeTruthy();
    });
    // The 20th, from the pull -- not the 14th the anchor carried.
    expect(screen.getByText('today:2026-09-20')).toBeTruthy();
    // And the anchor is REWRITTEN, so the next cold start restores the newer day.
    const saved = await persistence.loadAnchor(USER);
    expect(saved?.serverTime).toBe('2026-09-20T09:00:00+00:00');
  });
});

/**
 * `FE-W45` — the records and the ZONE they are read in must arrive together.
 *
 * `setStore` ran immediately after `loadPulledStore`, before the anchor was read, so there
 * was a render holding real visits with `zone` still at the initial `UTC_FALLBACK`. Every
 * clock and date rendered 5h30m wrong for IST and then corrected itself — which MR-28's own
 * comment calls worse than showing nothing.
 *
 * Ordering is the thing under test, so this records EVERY render rather than the final one.
 * A test that only reads the settled state passes against the defect.
 */
describe('FE-W45 — no render holds records in a fallback zone', () => {
  it('never shows restored visits while the zone is still UTC_FALLBACK', async () => {
    const seen: { doctors: number; zone: string; source: string }[] = [];
    const Watcher = (): ReactNode => {
      const { store, zone } = usePulledStore();
      seen.push({ doctors: store.doctor.size, zone: zone.timeZone, source: zone.source });
      return <BodyText>{`doctors:${String(store.doctor.size)}`}</BodyText>;
    };

    /**
     * **The double has to be as ASYNC as the real one, or this test proves nothing.**
     *
     * `memoryPulledStore` resolves `loadAnchor` synchronously, so React batches `setStore`
     * and `setZone` into one render and the intermediate state never exists. Mutating the
     * fix passed against the original version of this test for exactly that reason. On a
     * device `AsyncStorage.getItem` crosses the bridge -- a macrotask -- so React commits
     * the store before the anchor arrives, which is when the 5h30m render happens.
     */
    const inner = memoryPulledStore();
    const persistence = {
      ...inner,
      loadAnchor: async (id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return inner.loadAnchor(id);
      },
    };
    const base = emptyStore();
    const restored = { ...base, doctor: new Map([[ASHA.id, ASHA]]) };
    await persistence.save(USER, restored);
    await persistence.saveAnchor(USER, {
      serverTime: '2026-09-14T17:45:00.000Z',
      receivedAt: Date.now() - 30 * 60_000,
      timeZone: 'Asia/Kolkata',
      zoneSource: 'territory',
    });

    await render(
      <PulledStoreProvider
        cursors={memoryPullCursorStore()}
        persistence={persistence}
        pull={jest.fn(async () => Promise.reject(new Error('offline'))) as never}
      >
        <Watcher />
      </PulledStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('doctors:1')).toBeTruthy();
    });

    // The assertion that fails against the defect: no render had records AND a fallback zone.
    const bad = seen.filter((s) => s.doctors > 0 && s.source === 'fallback_utc');
    expect(bad).toEqual([]);
    // THE PRECONDITION: this fixture really did restore records, so the filter had something
    // to look at. Without it an empty `seen` would pass for the wrong reason.
    expect(seen.some((s) => s.doctors > 0)).toBe(true);
  });
});
