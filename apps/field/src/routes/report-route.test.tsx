import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';

/**
 * FE-D4 2 — the call report's labels come from the phone, not from the mock.
 *
 * The WRITE was converted in MR-18; the two READS were not. The doctor's name and the visit's date
 * came from `createClientForScenario().listVisits()/listDoctors()` — the mock at :4010 — so on the
 * demo phone the heading read whatever the mock held, or "This visit" when it was unreachable.
 * The same visit and doctor are already in the pulled store, which every other visit screen reads.
 * No backend and no contract change: this is where the data already is.
 */

const mockListVisits = jest.fn(() => new Promise(() => undefined));
const mockListDoctors = jest.fn(() => new Promise(() => undefined));
jest.mock('../api', () => ({
  createClientForScenario: () => ({ listVisits: mockListVisits, listDoctors: mockListDoctors }),
}));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createCallReport: jest.fn() }),
}));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import CallReport from '../../app/report/[visitId]';

const DOCTOR = '33333333-3333-4333-8333-333333333301';

const doctor = DoctorSchema.parse({
  id: DOCTOR,
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: 'Urologist',
  qualification: null,
  territoryId: '33333333-3333-4333-8333-3333333333cc',
  assignedMrId: null,
  clinicAddresses: [],
  isActive: true,
  createdAt: '2026-09-01T08:00:00+05:30',
  updatedAt: '2026-09-01T08:00:00+05:30',
});

/**
 * Completed at 18:45Z on 20 September: 00:15 IST on the 21st. The one instant where the UTC date
 * and the territory's date differ, so the label shows which clock it was read in.
 */
const visit = VisitSchema.parse({
  id: '44444444-4444-4444-8444-444444444401',
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: DOCTOR,
  beatPlanId: null,
  clinicAddressId: null,
  status: 'completed',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-20T18:30:00.000Z',
  completedAt: '2026-09-20T18:45:00.000Z',
  visitDay: '2026-09-21',
  receivedAt: '2026-09-20T18:45:01.000Z',
  createdAt: '2026-09-20T18:00:00.000Z',
  updatedAt: '2026-09-20T18:45:01.000Z',
});

const pulled = (visits: unknown[]) => ({
  store: {
    visit: new Map(visits.map((v) => [(v as { id: string }).id, v])),
    doctor: new Map([[DOCTOR, doctor]]),
    beat_plan: new Map(),
    clinic_address: new Map(),
    consent_text_version: new Map(),
  },
  status: 'ready',
  failure: null,
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  serverTime: '2026-09-21T06:00:00.000Z',
  today: '2026-09-21',
});

beforeEach(() => {
  mockListVisits.mockClear();
  mockListDoctors.mockClear();
  mockStore.mockReset();
});

describe('FE-D4 2 — call report labels from the phone', () => {
  it('names the doctor from the pulled store, with the mock unreachable', async () => {
    mockStore.mockReturnValue(pulled([visit]));
    await render(<CallReport />);

    expect(await screen.findByText(/Dr Asha Deshpande/u)).toBeTruthy();
    expect(screen.queryByText(/This visit/u)).toBeNull();
  });

  it('dates it in the TERRITORY: 18:45Z on 20 Sep is 21 Sep in IST', async () => {
    mockStore.mockReturnValue(pulled([visit]));
    await render(<CallReport />);

    expect(await screen.findByText(/21 Sep/u)).toBeTruthy();
    expect(screen.queryByText(/20 Sep/u)).toBeNull();
  });

  it('asks the mock for nothing', async () => {
    mockStore.mockReturnValue(pulled([visit]));
    await render(<CallReport />);
    await screen.findByText(/Dr Asha Deshpande/u);

    expect(mockListVisits).not.toHaveBeenCalled();
    expect(mockListDoctors).not.toHaveBeenCalled();
  });

  it('a visit the phone does not hold still gives a writable report, headed "This visit"', async () => {
    // Unchanged on purpose: the report stays writable without its label (the old comment's rule).
    mockStore.mockReturnValue(pulled([]));
    await render(<CallReport />);

    expect(screen.getByText(/This visit/u)).toBeTruthy();
  });

  // W2-C A3 / `BE-W156`. Offline on the emulator the header read "Dr … · " with nothing after it:
  // the check-out had not reached the server, so `completedAt` did not exist yet.
  it('BE-W156: before the server has the check-out, the header dates it by the server’s DAY', async () => {
    mockStore.mockReturnValue(pulled([{ ...visit, completedAt: null }]));
    await render(<CallReport />);
    expect(await screen.findByText('Dr Asha Deshpande · 21 Sep')).toBeTruthy();
  });

  it('BE-W156: with no day at all, it names the doctor and leaves NO dangling dot', async () => {
    mockStore.mockReturnValue(pulled([{ ...visit, completedAt: null, visitDay: null }]));
    await render(<CallReport />);
    expect(await screen.findByText('Dr Asha Deshpande')).toBeTruthy();
    expect(screen.queryByText(/·/u)).toBeNull();
  });
});
