import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';

/**
 * W2-C B / `BE-W159` — the rep FLAGS a possible side effect, from the visit (`BE-C36`).
 *
 * Through the REAL outbox and queue; only the push client is replaced, at the network boundary.
 * Both sides: an ordinary report — numbers and all — sends; a phone number withholds Send.
 */
const mockFlag = jest.fn<(body: unknown) => Promise<unknown>>();
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createAdverseEventFlag: mockFlag }),
}));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import { loadQueueState, setQueueOwner } from '../sync/async-storage-store';
import { flushOutbox } from '../sync/outbox';
import type { OutboxWriteClient } from '../sync/push-client';
import AdverseEventFlag from '../../app/adverse-event/[visitId]';

const DOCTOR = '33333333-3333-4333-8333-333333333301';
const VISIT = '44444444-4444-4444-8444-444444444401';

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
const visit = VisitSchema.parse({
  id: VISIT,
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: DOCTOR,
  beatPlanId: null,
  clinicAddressId: null,
  status: 'in_progress',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-10-06T05:00:00.000Z',
  completedAt: null,
  receivedAt: '2026-10-06T05:00:01.000Z',
  createdAt: '2026-10-06T04:00:00.000Z',
  updatedAt: '2026-10-06T05:00:01.000Z',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner('22222222-2222-4222-8222-2222222222aa');
  mockFlag.mockReset();
  mockStore.mockReturnValue({
    store: {
      visit: new Map([[VISIT, visit]]),
      doctor: new Map([[DOCTOR, doctor]]),
      beat_plan: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
    },
    status: 'ready',
    failure: null,
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  });
});

const type = async (text: string): Promise<void> => {
  await render(<AdverseEventFlag />);
  await screen.findByText('Flag a possible side effect');
  await fireEvent.changeText(screen.getByLabelText('What happened'), text);
};

describe('app/adverse-event/[visitId].tsx — W2-C B', () => {
  it('an ORDINARY report — numbers and all — SENDS, with who/when/what and nothing else', async () => {
    mockFlag.mockResolvedValue({ receivedAt: '2026-10-06T05:10:00Z', warnings: [] });
    await type('Rash after 500 mg twice a day for 10 days.');
    await fireEvent.press(screen.getByText('Send the flag'));

    expect(await screen.findByText('Flag sent')).toBeTruthy();
    expect(mockFlag).toHaveBeenCalledTimes(1);
    const body = mockFlag.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['clientReportedAt', 'id', 'reportedText', 'visitId']);
    expect(body['visitId']).toBe(VISIT);
    expect(body['reportedText']).toBe('Rash after 500 mg twice a day for 10 days.');
    // Nothing assessed, nothing about the patient, on screen either.
    expect(screen.queryByText(/severity|serious|related/iu)).toBeNull();
  });

  it('OFFLINE it is SAVED, says so — not "sent" — and queues as an adverse_event', async () => {
    mockFlag.mockRejectedValue(new Error('Network request failed'));
    await type('Dizziness after the first dose.');
    await fireEvent.press(screen.getByText('Send the flag'));

    expect(await screen.findByText('Flag saved')).toBeTruthy();
    expect(screen.queryByText('Flag sent')).toBeNull();
    const load = await loadQueueState();
    const items = load.kind === 'loaded' ? load.state.items : [];
    expect(items.map((item) => item.entity)).toEqual(['adverse_event']);

    // And it REPLAYS as a flag, the same one: same id (the idempotency key), same words.
    const sentBefore = mockFlag.mock.calls[0]?.[0] as { id: string };
    const replay = jest.fn(async () => Promise.resolve({ receivedAt: 'x', warnings: [] }));
    const result = await flushOutbox({
      createAdverseEventFlag: replay,
    } as unknown as OutboxWriteClient);
    expect(result.sent).toBe(1);
    const replayed = (replay.mock.calls[0] as unknown[] | undefined)?.[0] as Record<
      string,
      unknown
    >;
    expect(replayed['id']).toBe(sentBefore.id);
    expect(replayed['reportedText']).toBe('Dizziness after the first dose.');
    expect(Object.keys(replayed)).not.toContain('__queueEntity');
  });

  it('a PHONE NUMBER in the text withholds Send, says why, and sends nothing', async () => {
    await type('Rash. Call the patient on 98765 43210.');
    expect(await screen.findByText(/contains a phone number/u)).toBeTruthy();
    await fireEvent.press(screen.getByText('Send the flag'));
    await waitFor(() => {
      expect(mockFlag).not.toHaveBeenCalled();
    });
    expect(screen.queryByText('Flag sent')).toBeNull();
    expect(screen.queryByText('Flag saved')).toBeNull();
  });

  it('asks for no patient detail: the only field is the rep’s own words', async () => {
    await render(<AdverseEventFlag />);
    await screen.findByText('Flag a possible side effect');
    expect(
      screen.getByText(/Do not write the patient’s name, phone number, address/u),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/patient|age|severity/iu)).toBeNull();
  });
});
