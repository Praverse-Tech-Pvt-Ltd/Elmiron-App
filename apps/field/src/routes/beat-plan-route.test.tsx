import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

/**
 * `BE-W89`, client half — MR-45. The beat-plan SCREEN, bound to the pulled store.
 *
 * **Until MR-45 this screen had no route-level test at all.** Only the `BeatPlanScreen`
 * component was tested, so the binding — which plan it picked, which clock it used, what it
 * said when empty — had never been exercised. That is this codebase's characteristic defect:
 * code that looks exercised and is not.
 *
 * `usePulledStore` is mocked rather than wrapped in a real provider for the reason every route
 * test here gives: `pulled-store.tsx` imports `../session`, which reaches `../config`, whose
 * `loadAppConfig` throws at import without an `.env`.
 */

const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// eslint-disable-next-line import/first
import BeatPlanRoute from '../../app/beat-plan';

const MR = '22222222-2222-4222-8222-2222222222aa';
const TERRITORY = '22222222-2222-4222-8222-222222222222';
const PLAN = '55555555-5555-4555-8555-555555555501';
const D1 = '33333333-3333-4333-8333-333333333301';
const D2 = '33333333-3333-4333-8333-333333333302';

const doctor = (id: string, fullName: string) => ({
  id,
  fullName,
  registrationNumber: null,
  specialty: 'Urology',
  qualification: 'MBBS',
  territoryId: TERRITORY,
  assignedMrId: MR,
  isActive: true,
  createdAt: '2026-09-09T10:00:00.000+00:00',
  updatedAt: '2026-09-09T10:00:00.000+00:00',
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  mrId: MR,
  territoryId: TERRITORY,
  planDate: '2026-09-21',
  status: 'submitted',
  approvedByUserId: null,
  approvedAt: null,
  version: 1,
  supersedesBeatPlanId: null,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  ...over,
});

const entry = (id: string, doctorId: string, plannedSequence: number) => ({
  id,
  beatPlanId: PLAN,
  doctorId,
  clinicAddressId: null,
  plannedSequence,
});

/**
 * Started at 18:45Z — 00:15 IST on the NEXT day. The one instant where the UTC clock and the
 * territory's clock disagree about both the hour and the date, so a screen that sliced the ISO
 * string, or used the wrong zone, renders a visibly wrong time here and only here.
 */
const VISIT = {
  id: '44444444-4444-4444-8444-444444444444',
  mrId: MR,
  doctorId: D1,
  beatPlanId: PLAN,
  clinicAddressId: null,
  status: 'completed',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-20T18:45:00.000Z',
  completedAt: '2026-09-20T18:53:00.000Z',
  // MR-47 / BE-W107. The server's day for this visit: 18:53Z is 00:23 IST on the 21st, and the
  // pull sends that answer. The route no longer reckons it from the instant.
  visitDay: '2026-09-21',
  receivedAt: '2026-09-20T18:53:01.000Z',
  createdAt: '2026-09-20T18:00:00.000Z',
  updatedAt: '2026-09-20T18:53:01.000Z',
};

const store = (over: { plans?: unknown[]; entries?: unknown[]; visits?: unknown[] } = {}) => ({
  visit: new Map((over.visits ?? [VISIT]).map((v) => [(v as { id: string }).id, v])),
  doctor: new Map([
    [D1, doctor(D1, 'Dr Asha Deshpande')],
    [D2, doctor(D2, 'Dr Vikram Rao')],
  ]),
  beat_plan: new Map((over.plans ?? [plan()]).map((p) => [(p as { id: string }).id, p])),
  beat_plan_entry: new Map(
    (
      over.entries ?? [
        entry('55555555-5555-4555-8555-555555555512', D2, 2),
        entry('55555555-5555-4555-8555-555555555511', D1, 1),
      ]
    ).map((e) => [(e as { id: string }).id, e]),
  ),
  clinic_address: new Map(),
  consent_text_version: new Map(),
});

const pulled = (over: Record<string, unknown> = {}) => ({
  store: store(),
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  serverTime: '2026-09-20T18:55:00.000Z',
  today: '2026-09-21',
  dayOrigin: { kind: 'live' },
  refresh: jest.fn(),
  ...over,
});

beforeEach(() => {
  mockStore.mockReset();
});

describe('BE-W89 — the screen renders the plan from the pulled store', () => {
  it('shows a SUBMITTED plan, with its status stated', async () => {
    mockStore.mockReturnValue(pulled());
    await render(<BeatPlanRoute />);

    expect(screen.getByText('Submitted — not yet approved')).toBeTruthy();
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
    expect(screen.getByText('Dr Vikram Rao')).toBeTruthy();
  });

  it('does not claim the plan was approved', async () => {
    // The absence, at render level. Nothing in v1 writes `approved`, so an approved-looking
    // plan on this screen would be a claim about a manager decision that never happened.
    mockStore.mockReturnValue(pulled());
    await render(<BeatPlanRoute />);

    expect(screen.queryByText(/approved by/iu)).toBeNull();
  });

  it('counts the plan from the server’s stops, not the mock’s', async () => {
    mockStore.mockReturnValue(pulled());
    await render(<BeatPlanRoute />);

    // Two entries, one visit completed.
    expect(screen.getByText('2 planned · 1 done')).toBeTruthy();
  });
});

describe('BE-W89 B3 — the stop’s time is the TERRITORY’s clock', () => {
  it('shows 00:15 for a visit started at 18:45Z in an IST territory', async () => {
    mockStore.mockReturnValue(pulled());
    await render(<BeatPlanRoute />);

    expect(screen.getByText(/^00:15 · 8 min$/u)).toBeTruthy();
  });

  it('does NOT show the UTC hour — the old character slice would have printed 18:45', async () => {
    // The two assertions together are the test. Showing "00:15" alone could pass with the right
    // hour sitting beside a wrong one; the absence rules out the defect the slice produced.
    mockStore.mockReturnValue(pulled());
    await render(<BeatPlanRoute />);

    expect(screen.queryByText(/18:45/u)).toBeNull();
  });
});

describe('BE-W89 B4 — a plan whose stops have not arrived', () => {
  it('says the stops are syncing while the pull is still running', async () => {
    mockStore.mockReturnValue(pulled({ status: 'loading', store: store({ entries: [] }) }));
    await render(<BeatPlanRoute />);

    expect(screen.getByText('Your stops are still syncing')).toBeTruthy();
    expect(screen.queryByText('No route for today')).toBeNull();
  });

  it('says the plan has no stops only once the pull has settled', async () => {
    mockStore.mockReturnValue(pulled({ status: 'ready', store: store({ entries: [] }) }));
    await render(<BeatPlanRoute />);

    expect(screen.getByText('This plan has no stops')).toBeTruthy();
    expect(screen.queryByText('Your stops are still syncing')).toBeNull();
  });

  it('says no route when there is genuinely no plan for today', async () => {
    mockStore.mockReturnValue(pulled({ store: store({ plans: [], entries: [] }) }));
    await render(<BeatPlanRoute />);

    expect(screen.getByText('No route for today')).toBeTruthy();
  });
});
