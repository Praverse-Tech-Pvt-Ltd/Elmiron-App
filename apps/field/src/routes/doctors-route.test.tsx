import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * MR-14 B2. The list reads the store the pull maintains, not the mock API client, so the
 * boundary this route is mocked at moved with it.
 *
 * **Every property this file guarded before the conversion is still guarded here**, and
 * that is the point of rewriting it rather than replacing it. The first draft of
 * `pulled-store.tsx` collapsed "the server refused" and "nothing answered" into one
 * failure field, and the case below named *separates a transport failure from a denial*
 * is what caught it.
 *
 * Mocked rather than wrapped in a real provider because `pulled-store.tsx` imports
 * `../session`, which imports `../supabase` and then `../config`, whose `loadAppConfig`
 * throws at module load on a missing EXPO_PUBLIC_* value. That is correct for the app and
 * wrong for a unit test with no `.env`. The PROVIDER is exercised for real, with injected
 * dependencies and no config, in `src/sync/pulled-store.test.tsx`.
 */
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

// The list opens a profile, so the route reads the router. Mocked because the real module
// pulls in `standard-navigation`, which ships untransformed ESM that jest's
// transformIgnorePatterns does not cover.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import Doctors from '../../app/(tabs)/doctors';

const emptyLocalStore = () => ({
  visit: new Map(),
  doctor: new Map(),
  beat_plan: new Map(),
  // MR-46 D1. The real store has carried this map since MR-44 (`pull.ts` LocalStore); the
  // double did not, because nothing on this screen read it until the "On plan" chip.
  beat_plan_entry: new Map(),
  clinic_address: new Map(),
});

/** One doctor and one completed visit, in the shape the store's maps hold. */
const DOCTOR = {
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

/** Completed at 23:00 IST on 29 September — the day before the territory's 1 October. */
const VISIT = {
  id: '44444444-4444-4444-8444-444444444444',
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: DOCTOR.id,
  beatPlanId: null,
  clinicAddressId: null,
  status: 'completed',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-29T16:30:00.000Z',
  completedAt: '2026-09-29T17:30:00.000Z',
  receivedAt: '2026-09-29T17:30:01.000Z',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T17:30:01.000Z',
} as const;

const pulled = (over: Record<string, unknown> = {}) => ({
  store: emptyLocalStore(),
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  // FE-W42 C1. The ages on this screen are measured from the SERVER's instant, in the
  // TERRITORY's zone. Both are part of the store's contract now, so the double carries them.
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  serverTime: '2026-09-30T18:35:00.000Z',
  today: '2026-10-01',
  dayOrigin: { kind: 'live' },
  refresh: jest.fn(),
  ...over,
});

/** 42501 — the server considered the request and refused it. */
const denial = {
  kind: 'refused',
  refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
};

beforeEach(() => {
  mockStore.mockReturnValue(pulled());
});

describe('app/doctors.tsx — how the client presents a server decision', () => {
  it('renders a denial as a denial, never as an empty list', async () => {
    // The whole point of the screen. An empty list is what a client-side filter looks
    // like, and the client never decides what an MR may see. This asserts the two are
    // distinguishable on screen.
    mockStore.mockReturnValue(pulled({ status: 'failed', failure: denial }));
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('You do not have access to this list')).toBeTruthy();
    });
    expect(screen.queryByText('No doctors in your territory yet.')).toBeNull();
  });

  it('names an EXPIRED sign-in as one — not a refusal, not a lost signal (FE-W56)', async () => {
    // Seen on the Pixel 10: "The server refused this sync (PGRST303)". PostgREST answers an
    // expired token with 401 PGRST303; the server refused nothing, and the remedy is to sign in.
    mockStore.mockReturnValue(
      pulled({
        status: 'failed',
        failure: {
          kind: 'refused',
          refusal: { code: 'not_authenticated', sqlState: 'PGRST303', actionable: true },
        },
      }),
    );
    await render(<Doctors />);
    expect(await screen.findByText('Your sign-in has expired')).toBeTruthy();
    expect(screen.queryByText(/refused/u)).toBeNull();
    expect(screen.queryByText(/could not reach/u)).toBeNull();
  });

  it('distinguishes an empty territory from a refused one', async () => {
    // Same screen, different server answer, different words. If these two collapsed into
    // one state the MR could not tell "you have none" from "you may not look".
    mockStore.mockReturnValue(pulled());
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('No doctors in your territory yet.')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });

  it('names what is loading rather than showing a bare spinner', async () => {
    mockStore.mockReturnValue(pulled({ status: 'loading' }));
    await render(<Doctors />);
    expect(screen.getByLabelText('Getting your doctor list')).toBeTruthy();
  });

  it('separates a transport failure from a denial', async () => {
    // A network error is not a permission problem, and telling an MR they lack access
    // when the wifi dropped is how trust in the app dies.
    //
    // **This case caught a real regression during MR-14 B2.** The conversion's first draft
    // gave the provider a single `refusal` field, so an unreachable server and a 42501
    // rendered the same words. `PullFailure` is a discriminated union because of this test.
    mockStore.mockReturnValue(pulled({ status: 'failed', failure: { kind: 'unreachable' } }));
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('Could not load doctors')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });

  it('does not offer "On plan" when there is no plan for today', async () => {
    // MR-14 B9, updated by MR-44 B. **This comment's original reason is no longer true and
    // the assertion is still right**, which is exactly what it was written to force: it said
    // "adding the entity is a change to this test rather than a chip quietly reappearing",
    // and the entity was added.
    //
    // MR-45 CORRECTION. MR-44 wrote here that this screen "still reads
    // `createClientForScenario()`". It does not — this very test mocks `usePulledStore` to
    // drive it, which is the evidence that was sitting in the file. MR-45 confirmed it by
    // ELIMINATION: mock dead, screen still renders the server's doctors.
    //
    // So the chip is no longer blocked by a missing entity or a missing read. It is absent
    // because nobody has built it yet, and it should reuse `todaysPlan` from
    // `src/today/beat-plan-view.ts` rather than grow a second definition of "today's plan".
    // This assertion stays until then, so the chip cannot reappear without a deliberate test.
    //
    // MR-46 D1. It was built, and this assertion survived it for a NEW reason: this store holds
    // no plan for today, and `onPlanDoctorIds` offers no chip without one. The chip's own
    // cases are in the "On plan" block at the end of this file.
    mockStore.mockReturnValue(pulled());
    await render(<Doctors />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.queryByText('On plan')).toBeNull();
  });
});

/**
 * `FE-W42` C1/C2/C3 — the "last seen" age, and the three states it actually has.
 *
 * The reference instant used to be `Date.now()`. It is now `serverTime`, which is nullable,
 * and a null one produced `daysSince === null` — the value `lastSeenLabel` already used for
 * **never visited**. For one commit this screen would have told an MR that a doctor they
 * saw last week had never been seen, which is false in the direction that wastes a visit.
 *
 * `2026-09-30T18:35:00Z` is 00:05 IST on 1 October: past the territory's midnight while UTC
 * still reads 30 September. The visit below completed at 23:00 IST on 29 September, so the
 * answer differs depending on which calendar the age is counted in.
 */
describe("app/doctors.tsx — FE-W42, the age is the server's or it is not claimed", () => {
  const withDoctor = (over: Record<string, unknown> = {}) => {
    const store = emptyLocalStore();
    store.doctor.set(DOCTOR.id, DOCTOR);
    store.visit.set(VISIT.id, VISIT);
    return pulled({ store, ...over });
  };

  it('measures the age from the SERVER instant', async () => {
    mockStore.mockReturnValue(withDoctor());
    await render(<Doctors />);
    // 29 Sep 23:00 IST to 1 Oct 00:05 IST is one calendar day and change: "yesterday".
    await waitFor(() => {
      expect(screen.getByText(/yesterday/u)).toBeTruthy();
    });
  });

  it('with NO server clock, renders the DATE and never "never visited"', async () => {
    mockStore.mockReturnValue(withDoctor({ serverTime: null, dayOrigin: { kind: 'none' } }));
    await render(<Doctors />);

    // The assertion that fails against the defect this conversion nearly shipped.
    await waitFor(() => {
      expect(screen.getByText(/last seen 29 Sep/u)).toBeTruthy();
    });
    expect(screen.queryByText(/never visited/u)).toBeNull();
    // And no age is claimed, in either direction.
    expect(screen.queryByText(/yesterday|days ago|weeks ago/u)).toBeNull();
  });

  it('with NO server clock, does NOT badge a visited doctor Overdue', async () => {
    /**
     * Found by mutation, not by design: reverting `overdue` to `daysSince === null || ...`
     * left every test green while marking **every doctor on the list** Overdue the moment
     * the server clock was unknown. Overdue is not decoration -- it drives the badge and
     * the filter of the same name, so it changes which doctors an MR drives to.
     *
     * "Never visited" is knowable with no clock at all, which is why the real rule keys on
     * `lastSeenAt`; "seen 40 days ago" is not.
     */
    mockStore.mockReturnValue(withDoctor({ serverTime: null, dayOrigin: { kind: 'none' } }));
    await render(<Doctors />);

    await waitFor(() => {
      expect(screen.getByText(/last seen 29 Sep/u)).toBeTruthy();
    });
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it('THE POSITIVE CONTROL: a doctor truly never visited still says so', async () => {
    // Without this, the case above is satisfiable by deleting "never visited" entirely,
    // which would lose the one label that is right when a doctor has not been seen.
    const store = emptyLocalStore();
    store.doctor.set(DOCTOR.id, DOCTOR);
    mockStore.mockReturnValue(pulled({ store, serverTime: null }));

    await render(<Doctors />);

    await waitFor(() => {
      expect(screen.getByText(/never visited/u)).toBeTruthy();
    });
    // And it IS Overdue -- without this, the case above is satisfiable by never badging
    // anything, which would lose the one signal this screen exists to give.
    expect(screen.getByText('Overdue')).toBeTruthy();
  });
});

describe('app/doctors.tsx — "On plan" (MR-46 D1, the last of BE-W89)', () => {
  const OTHER = {
    ...DOCTOR,
    id: '33333333-3333-4333-8333-333333333334',
    fullName: 'Dr Meera Iyer',
  };
  const PLAN = {
    id: '55555555-5555-4555-8555-555555555501',
    mrId: VISIT.mrId,
    territoryId: DOCTOR.territoryId,
    planDate: '2026-10-01',
    status: 'submitted',
    approvedByUserId: null,
    approvedAt: null,
    version: 1,
    supersedesBeatPlanId: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    updatedAt: '2026-09-30T08:00:00.000Z',
  } as const;
  const ENTRY = {
    id: '55555555-5555-4555-8555-555555555511',
    beatPlanId: PLAN.id,
    doctorId: DOCTOR.id,
    clinicAddressId: null,
    plannedSequence: 1,
  } as const;

  /** Two doctors; only Asha is on today's plan, and she has a PAST visit. */
  const withPlan = (entries: readonly (typeof ENTRY)[], over: Record<string, unknown> = {}) =>
    pulled({
      store: {
        ...emptyLocalStore(),
        doctor: new Map([
          [DOCTOR.id, DOCTOR],
          [OTHER.id, OTHER],
        ]),
        visit: new Map([[VISIT.id, VISIT]]),
        beat_plan: new Map([[PLAN.id, PLAN]]),
        beat_plan_entry: new Map(entries.map((e) => [e.id, e])),
      },
      ...over,
    });

  it('offers the chip and keeps only the doctor on today’s plan', async () => {
    mockStore.mockReturnValue(withPlan([ENTRY]));
    await render(<Doctors />);
    await fireEvent.press(await screen.findByText('On plan'));

    await waitFor(() => {
      expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
    });
    // The negative half: a doctor NOT on the plan is gone, so the chip filtered something.
    expect(screen.queryByText('Dr Meera Iyer')).toBeNull();
  });

  it('POSITIVE CONTROL: without the chip, both doctors are listed', async () => {
    mockStore.mockReturnValue(withPlan([ENTRY]));
    await render(<Doctors />);
    expect(await screen.findByText('Dr Meera Iyer')).toBeTruthy();
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
  });

  it('does NOT offer the chip while the plan’s stops are still syncing', async () => {
    mockStore.mockReturnValue(withPlan([], { status: 'loading' }));
    await render(<Doctors />);
    await screen.findByText('Not seen 30d');
    expect(screen.queryByText('On plan')).toBeNull();
  });
});
