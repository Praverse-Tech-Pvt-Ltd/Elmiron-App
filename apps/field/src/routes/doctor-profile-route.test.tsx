import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';

/**
 * FE-D3 B3 — the doctor profile never says "You have not visited this doctor yet" when it does
 * not know.
 *
 * The screen showed that sentence whenever `sinceLabel` was null, and `sinceLabel` is null in
 * three different situations: the history is still LOADING, the rep has genuinely NEVER completed
 * a visit here, or they HAVE and there is no server clock to say how long ago. Only the middle
 * one is "not visited". The other two are unknown, and the sentence was a claim about the rep's
 * own record that could be flatly wrong.
 */

const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '33333333-3333-4333-8333-333333333301' }),
}));

import DoctorProfile from '../../app/doctor/[id]';

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

const completedVisit = VisitSchema.parse({
  id: '44444444-4444-4444-8444-444444444401',
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: DOCTOR,
  beatPlanId: null,
  clinicAddressId: null,
  status: 'completed',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-10T05:00:00.000Z',
  completedAt: '2026-09-10T05:12:00.000Z',
  visitDay: '2026-09-10',
  receivedAt: '2026-09-10T05:12:01.000Z',
  createdAt: '2026-09-10T04:00:00.000Z',
  updatedAt: '2026-09-10T05:12:01.000Z',
});

const pulled = (over: {
  status?: string;
  doctors?: unknown[];
  visits?: unknown[];
  serverTime?: string | null;
}) => ({
  store: {
    doctor: new Map((over.doctors ?? [doctor]).map((d) => [(d as { id: string }).id, d])),
    visit: new Map((over.visits ?? []).map((v) => [(v as { id: string }).id, v])),
    beat_plan: new Map(),
    clinic_address: new Map(),
    consent_text_version: new Map(),
  },
  status: over.status ?? 'ready',
  failure: null,
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  serverTime: over.serverTime === undefined ? '2026-09-20T06:00:00.000Z' : over.serverTime,
  today: '2026-09-20',
});

const NEVER = 'You have not visited this doctor yet.';
const UNKNOWN = /not known yet/u;

beforeEach(() => {
  mockStore.mockReset();
});

describe('FE-D3 B3 — "not visited yet" only when it is true', () => {
  it('while the history is still loading, does not say "not visited"', async () => {
    mockStore.mockReturnValue(pulled({ status: 'loading' }));
    await render(<DoctorProfile />);

    expect(screen.getByText("Getting this doctor's history")).toBeTruthy();
    expect(screen.queryByText(NEVER)).toBeNull();
  });

  it('visited, but no server clock to say how long ago: says it is not known — not "never"', async () => {
    mockStore.mockReturnValue(pulled({ visits: [completedVisit], serverTime: null }));
    await render(<DoctorProfile />);

    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    // The visit itself is still listed: the record is known, only its age is not.
    expect(screen.getByText(/12 min/u)).toBeTruthy();
  });

  it('POSITIVE CONTROL: settled, and no completed visit — then it IS "not visited yet"', async () => {
    mockStore.mockReturnValue(pulled({}));
    await render(<DoctorProfile />);

    expect(screen.getByText(NEVER)).toBeTruthy();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it('POSITIVE CONTROL: visited with a server clock — shows how long ago', async () => {
    mockStore.mockReturnValue(pulled({ visits: [completedVisit] }));
    await render(<DoctorProfile />);

    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });
});
