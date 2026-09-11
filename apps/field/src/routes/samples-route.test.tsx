import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiRequestError, DoctorSchema, VisitSchema } from '@fieldforce/core';

const mockCreateSampleAndInput = jest.fn<(body: unknown) => Promise<unknown>>();
/**
 * MR-21 B1. The READ boundary moved too: this screen now takes its visit and doctor from
 * the store the pull maintains, not from `createClientForScenario()`. Mocked rather than
 * wrapped in a real provider because `pulled-store.tsx` imports `../session` -> `../supabase`
 * -> `../config`, whose `loadAppConfig` throws at module load with no `.env`. The provider
 * itself is exercised for real in `src/sync/pulled-store.test.tsx`.
 */
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
// MR-18 B1. The WRITE boundary moved from the mock REST client to `sync_push`, so the
// mock moved with it. The reads on these screens are still `createClientForScenario`, and
// both are mocked here because the screen uses both -- which is exactly the two-column
// distinction the real-versus-fixture table is about.
jest.mock('../sync/push-client', () => ({
  // **`SyncPushRefusal` must stay REAL.** `sendOrQueue` classifies refusals with
  // `error instanceof SyncPushRefusal` (MR-24 defect 2), so a mock that omits the class makes
  // that expression `instanceof undefined` and throws `TypeError: Right-hand side of
  // 'instanceof' is not an object` — which is what this file did until MR-28, and it is why
  // the mock spreads the real module rather than replacing it.
  //
  // A look-alike class would be worse than the throw: `instanceof` would be false, the
  // refusal would be treated as a transport failure and queued, and the test would pass while
  // asserting the opposite of the behaviour.
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createSampleAndInput: mockCreateSampleAndInput }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ visitId: '22222222-2222-4222-8222-222222222201' }),
}));

import { SyncPushRefusal } from '../sync/push-client';
import SamplesRoute from '../../app/samples/[visitId]';

const visit = VisitSchema.parse({
  id: '22222222-2222-4222-8222-222222222201',
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: '22222222-2222-4222-8222-2222222222bb',
  beatPlanId: null,
  clinicAddressId: null,
  status: 'in_progress',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-08-14T11:58:00+05:30',
  completedAt: null,
  receivedAt: '2026-08-14T11:58:01+05:30',
  createdAt: '2026-08-14T08:00:00+05:30',
  updatedAt: '2026-08-14T11:58:01+05:30',
});

const doctor = DoctorSchema.parse({
  id: '22222222-2222-4222-8222-2222222222bb',
  fullName: 'Dr. S. Iyer',
  registrationNumber: null,
  specialty: 'Urologist',
  qualification: null,
  territoryId: '22222222-2222-4222-8222-2222222222cc',
  assignedMrId: null,
  clinicAddresses: [],
  isActive: true,
  createdAt: '2026-08-01T08:00:00+05:30',
  updatedAt: '2026-08-01T08:00:00+05:30',
});

/** A settled store holding whichever rows a case needs. */
const pulled = (visits: unknown[], doctors: unknown[]) => ({
  store: {
    visit: new Map(visits.map((v) => [(v as { id: string }).id, v])),
    doctor: new Map(doctors.map((d) => [(d as { id: string }).id, d])),
    beat_plan: new Map(),
    clinic_address: new Map(),
  },
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  today: '2026-08-14',
  refresh: jest.fn(),
});

const loaded = () => {
  mockStore.mockReturnValue(pulled([visit], [doctor]));
};

describe('app/samples/[visitId].tsx — C5', () => {
  it('opens on the doctor being visited, with one empty line ready', async () => {
    loaded();
    await render(<SamplesRoute />);
    expect(await screen.findByText(/Dr\. S\. Iyer/u)).toBeTruthy();
    // One line, so no removal is offered yet.
    expect(screen.queryByText('Remove this item')).toBeNull();
  });

  it('refuses to send a line with no declared value, and says what is missing', async () => {
    // The screen's hardest rule: a zero here would be a false declaration in an
    // append-only, audit-triggered table, so an empty field stops the send rather
    // than defaulting.
    loaded();
    mockCreateSampleAndInput.mockClear();
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(mockCreateSampleAndInput).not.toHaveBeenCalled();
    expect(screen.getByText(/declared value of one pack in rupees/u)).toBeTruthy();
  });

  it('sends a complete line as a contract request and clears the screen', async () => {
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockResolvedValue({});
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.changeText(screen.getByLabelText('Declared value, ₹ each'), '240');
    await fireEvent.press(screen.getByLabelText('One more Packs'));
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(await screen.findByText('Recorded')).toBeTruthy();
    expect(mockCreateSampleAndInput).toHaveBeenCalledTimes(1);
    expect(mockCreateSampleAndInput).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: visit.id,
        doctorId: doctor.id,
        kind: 'sample',
        itemName: 'Elmiron 100 mg, 30s',
        quantity: 2,
        declaredValueInr: 240,
      }),
    );
  });

  it('keeps a refused line on screen carrying the server’s own words', async () => {
    // A refusal is a verdict, not a failure to send. The line stays put so the MR
    // can correct it; nothing is queued, because the server already has it.
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'validation_failed',
        message: 'This visit is already closed.',
        requestId: 'req-1',
        fieldErrors: null,
      }),
    );
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.changeText(screen.getByLabelText('Declared value, ₹ each'), '240');
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(await screen.findByText('This visit is already closed.')).toBeTruthy();
    expect(screen.queryByText('Recorded')).toBeNull();
  });

  it('BE-W97 \u2014 a 45004 arrives with the CAP, the month-to-date and the period', async () => {
    // **This is the case `G-WRITE`'s last item is about.** MR-27 C2 drove a real 45004 from
    // this screen with a test-only cap of 1 and a sample of 2. It fired, it was refused, and
    // what the MR read was:
    //
    //     this would put MR27 UCPMP c over the UCPMP cap for
    //     83aa5660-470b-4c82-aa90-000b5347cb1c this month
    //
    // A raw doctor UUID and no figures. The brief's test is "45004 with the cap,
    // month-to-date and period as real numbers", and a sentence containing a UUID and no
    // numbers does not satisfy it.
    //
    // The refusal below is the SHAPE the server now produces: `enforce_ucpmp_sample_cap`'s
    // own DETAIL, threaded through `sync_push` by 20260911000800, with the doctor named
    // rather than identified by 20260911000900.
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockRejectedValue(
      new SyncPushRefusal({
        message: 'this would put Elmiron 100 mg, 30s over the UCPMP cap for Dr. S. Iyer this month',
        sqlState: '45004',
        rejectionCode: 'internal_error',
        deadLettered: false,
        detail: 'cap 1, already given 0, this entry 2, period starting 2026-09-01',
        hint: 'Stop and speak to your manager. The quantity is never trimmed to fit.',
      }),
    );
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.changeText(screen.getByLabelText('Declared value, \u20b9 each'), '240');
    await fireEvent.press(screen.getByText('Record what I left'));

    // One node, read back and asserted figure by figure. `findByText` with a substring
    // matcher would pass on a screen showing only part of it.
    const shown = await screen.findByText(/UCPMP limit/u);
    const children: unknown = (shown.props as { children?: unknown }).children;
    // The screen renders the whole refusal in ONE Text node, and that is ASSERTED rather
    // than assumed: if it were split across children, `String(children)` would be
    // "[object Object]" and every `toContain` below would fail for a reason that looks
    // nothing like the reason.
    expect(typeof children).toBe('string');
    const text = children as string;
    expect(text).toContain('speak to your manager');
    expect(text).toContain('cap 1');
    expect(text).toContain('already given 0');
    expect(text).toContain('this entry 2');
    expect(text).toContain('period starting 2026-09-01');
    // And no UUID anywhere in it. This is the half of the finding that is about the
    // MESSAGE rather than the DETAIL, and it would still be broken if only the transport
    // had been fixed.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);

    // The line stays put, and nothing was queued: the server answered.
    expect(screen.queryByText('Recorded')).toBeNull();
    expect(screen.getByLabelText('What you left').props.value).toBe('Elmiron 100 mg, 30s');
  });
});

/**
 * MR-20 B3 — the tap must produce something.
 *
 * **This is the case that holds the behaviour once Part C makes the defect unreachable.**
 * MR-19 pressed a primary action against a real Supabase visit id while the screen read the
 * mock: `visit === null`, the handler returned on its first line, and there was no error, no
 * message, no busy state and nothing on the wire. The MR would have pressed it again.
 *
 * Converting the reads stops `visit === null` happening in the common case — which is
 * exactly why this exists now rather than after.
 */
describe('MR-20 B3 — a tap on an unusable screen is never silent', () => {
  it('says the visit is not on this phone rather than doing nothing', async () => {
    // The server holds no visit with this id, which is precisely the MR-19 state: the
    // screen was opened for an id its data source does not have.
    // The store holds no visit with this id -- precisely the MR-19 state.
    mockStore.mockReturnValue(pulled([], [doctor]));
    mockCreateSampleAndInput.mockClear();

    await render(<SamplesRoute />);
    await fireEvent.press(await screen.findByText('Record what I left'));

    expect(await screen.findByText('This visit is not on your phone')).toBeTruthy();
    // ...and nothing was sent, because there was nothing to send it against.
    expect(mockCreateSampleAndInput).not.toHaveBeenCalled();
  });

  it('and stays silent when the screen IS usable — the positive control', async () => {
    // Without this, "always show the message" would pass the case above while putting a
    // permanent error on a working screen. A guard that fires on correct states gets
    // deleted, and its removal takes the real coverage with it.
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockResolvedValue({});

    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    expect(screen.queryByText('This visit is not on your phone')).toBeNull();
  });
});
