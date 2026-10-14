import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DoctorSchema } from '@fieldforce/core';

/**
 * `BE-W176` — Add an unplanned visit, on the screen, with the REAL outbox and the real (in-memory)
 * AsyncStorage queue. Only the server is a double: `createUnplannedVisit` answers, or does not.
 *
 * What it proves: the button stays shut until doctor and reason are right; pressing it queues one
 * `visit` item first, then sends; with or without signal the rep lands on that visit; a refusal is
 * said on this screen rather than opening a visit that does not exist.
 */

type Send = () => Promise<unknown>;
let mockSend: Send = () => Promise.resolve({ receivedAt: '2026-10-09T11:00:00Z', warnings: [] });
const mockCreateUnplannedVisit = jest.fn((_body: unknown) => mockSend());
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createUnplannedVisit: mockCreateUnplannedVisit }),
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
jest.mock('expo-modules-core/src/uuid', () => ({
  __esModule: true,
  default: { v4: () => '66666666-6666-4666-8666-666666666601' },
}));

const DOCTOR = '33333333-3333-4333-8333-333333333301';
const mockDoctorId = DOCTOR;
const CLINIC = '44444444-4444-4444-8444-444444444401';
const mockDoctor = DoctorSchema.parse({
  id: DOCTOR,
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: null,
  qualification: null,
  territoryId: '11111111-1111-4111-8111-111111111103',
  assignedMrId: null,
  clinicAddresses: [
    {
      id: CLINIC,
      doctorId: DOCTOR,
      label: 'Main clinic',
      line1: '1 Road',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      coordinates: null,
      geofenceRadiusMetres: 150,
    },
  ],
  isActive: true,
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
});
const mockRefresh = jest.fn();
/** `FE-W191`. When true, today's plan carries the one doctor this phone holds. */
const mockPlan = { onPlan: false };
const PLAN = '55555555-5555-4555-8555-555555555501';
const mockPlanId = PLAN;
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    store: {
      visit: new Map(),
      doctor: new Map([[mockDoctorId, mockDoctor]]),
      beat_plan: new Map(
        mockPlan.onPlan
          ? [
              [
                mockPlanId,
                { id: mockPlanId, planDate: '2026-10-09', version: 1, status: 'approved' },
              ],
            ]
          : [],
      ),
      beat_plan_entry: new Map(
        mockPlan.onPlan
          ? [['entry-1', { id: 'entry-1', beatPlanId: mockPlanId, doctorId: mockDoctorId }]]
          : [],
      ),
      // Where the real store keeps clinics: their own map, joined to the doctor on read.
      clinic_address: new Map(mockDoctor.clinicAddresses.map((clinic) => [clinic.id, clinic])),
      consent_text_version: new Map(),
    },
    status: 'ready',
    failure: null,
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    serverTime: '2026-10-09T10:00:00Z',
    today: '2026-10-09',
    refresh: mockRefresh,
  }),
}));

import { SyncPushRefusal } from '../sync/push-client';
import { loadQueueState, setQueueOwner } from '../sync/async-storage-store';
import UnplannedVisit from '../../app/unplanned-visit';

const VISIT = '66666666-6666-4666-8666-666666666601';

const choose = async (reason: string): Promise<void> => {
  await fireEvent(screen.getByLabelText('Doctor'), 'onChange', DOCTOR);
  await fireEvent.changeText(screen.getByLabelText('Reason'), reason);
};

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner('22222222-2222-4222-8222-2222222222aa');
  mockCreateUnplannedVisit.mockClear();
  mockReplace.mockClear();
  mockRefresh.mockClear();
  mockPlan.onPlan = false;
  mockSend = () => Promise.resolve({ receivedAt: '2026-10-09T11:00:00Z', warnings: [] });
});

describe('BE-W176 — Add an unplanned visit', () => {
  it('the button is shut until a doctor and a reason are given, and says what is missing', async () => {
    await render(<UnplannedVisit />);
    expect(screen.getByText('Choose the doctor you are visiting.')).toBeTruthy();
    await choose('hi');
    expect(
      screen.getByText('Say why you are making this visit — a few words is enough.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Start this visit'));
    expect(mockCreateUnplannedVisit).not.toHaveBeenCalled();
  });

  it('with signal: queued first, sent as UNPLANNED with its reason, and the rep is taken into the visit', async () => {
    await render(<UnplannedVisit />);
    await choose('Doctor called me in');
    await fireEvent.press(screen.getByText('Start this visit'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(`/visit/${VISIT}`);
    });
    expect(mockCreateUnplannedVisit).toHaveBeenCalledWith({
      id: VISIT,
      doctorId: DOCTOR,
      clinicAddressId: CLINIC,
      scheduledFor: expect.any(String),
      unplannedReason: 'Doctor called me in',
    });
    const load = await loadQueueState();
    if (load.kind !== 'loaded') throw new Error('queue unreadable');
    expect(load.state.items).toHaveLength(1);
    expect(load.state.items[0]).toMatchObject({ id: VISIT, entity: 'visit', status: 'synced' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('no signal: still on the phone, still opened -- and waiting to send', async () => {
    mockSend = () => Promise.reject(new Error('Network request failed'));
    await render(<UnplannedVisit />);
    await choose('Doctor called me in');
    await fireEvent.press(screen.getByText('Start this visit'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(`/visit/${VISIT}`);
    });
    const load = await loadQueueState();
    if (load.kind !== 'loaded') throw new Error('queue unreadable');
    expect(load.state.items[0]).toMatchObject({
      id: VISIT,
      entity: 'visit',
      status: 'queued',
      payload: expect.objectContaining({ unplannedReason: 'Doctor called me in' }),
    });
  });

  it('refused by the server: said here, and no visit is opened', async () => {
    mockSend = () =>
      Promise.reject(
        new SyncPushRefusal({
          message: 'unplanned_visit_needs_reason',
          sqlState: '22023',
          rejectionCode: 'validation_failed',
          deadLettered: false,
          detail: null,
          hint: null,
        }),
      );
    await render(<UnplannedVisit />);
    await choose('Doctor called me in');
    await fireEvent.press(screen.getByText('Start this visit'));

    expect(await screen.findByText('This visit was not accepted')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * `FE-W191`. The sheet offered doctors already on today's plan (QA screenshot 52), under a
   * screen that says it is for a doctor who is NOT on it.
   */
  it('FE-W191: offers no doctor who is already on today’s plan, and says why the list is empty', async () => {
    mockPlan.onPlan = true;
    await render(<UnplannedVisit />);
    expect(
      screen.getByText(
        'Every doctor on this phone is on today’s plan. Open them from Today or today’s route.',
      ),
    ).toBeTruthy();
    // The sheet, opened: the doctor is not in it.
    await fireEvent.press(screen.getByLabelText('Doctor'));
    expect(screen.queryByText('Dr Asha Deshpande')).toBeNull();
  });

  it('FE-W191: POSITIVE CONTROL — with no plan for today, the same doctor is offered', async () => {
    await render(<UnplannedVisit />);
    await fireEvent.press(screen.getByLabelText('Doctor'));
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
  });
});
