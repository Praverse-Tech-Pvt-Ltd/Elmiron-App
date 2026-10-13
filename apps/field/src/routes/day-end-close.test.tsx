import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VisitSchema, fromWorkDayRow } from '@fieldforce/core';
import type { Visit, WorkDay } from '@fieldforce/core';

/**
 * `FE-W80` / `BE-W190` — "End my day", on the screen, with the REAL outbox and the real (in-memory)
 * AsyncStorage queue. Only the server is a double: `sendWorkDay` answers, refuses, or does not.
 *
 * What it proves: the button is offered on an open day and shut, with its reason, while a visit is
 * checked in; pressing it queues one `work_day` close and sends it; with no signal the card says the
 * end is on the PHONE and waiting, never that the server has it; a refusal is shown with its remedy;
 * and a day the SERVER has ended shows the server's time and offers nothing.
 */

type Send = () => Promise<unknown>;
let mockSend: Send = () => Promise.resolve({ receivedAt: '2026-10-13T12:52:01Z', warnings: [] });
const mockSendWorkDay = jest.fn((_body: unknown) => mockSend());
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ sendWorkDay: mockSendWorkDay }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-modules-core/src/uuid', () => ({
  __esModule: true,
  default: { v4: () => '66666666-6666-4666-8666-666666666601' },
}));
jest.mock('../capture/visits', () => ({
  listMileage: () => Promise.resolve({ kind: 'loaded', days: [] }),
}));
jest.mock('../api', () => ({ createClientForScenario: () => ({}) }));

const MR = '22222222-2222-4222-8222-2222222222aa';
const TODAY = '2026-10-13';
const mockRefresh = jest.fn();
let mockVisits: Visit[] = [];
let mockDays: WorkDay[] = [];
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    store: {
      visit: new Map(mockVisits.map((v) => [v.id, v])),
      doctor: new Map(),
      beat_plan: new Map(),
      beat_plan_entry: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
      work_day: new Map(mockDays.map((d) => [d.id, d])),
    },
    status: 'ready',
    failure: null,
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    serverTime: '2026-10-13T12:50:00Z',
    today: TODAY,
    refresh: mockRefresh,
  }),
}));

import { SyncPushRefusal } from '../sync/push-client';
import { loadQueueState, setQueueOwner } from '../sync/async-storage-store';
import DayEnd from '../../app/day-end';

const visit = (status: Visit['status']): Visit =>
  VisitSchema.parse({
    id: '22222222-2222-4222-8222-222222222201',
    mrId: MR,
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status,
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-10-13T03:25:00+00:00',
    completedAt: status === 'completed' ? '2026-10-13T04:25:00+00:00' : null,
    receivedAt: '2026-10-13T03:25:01+00:00',
    createdAt: '2026-10-13T02:30:00+00:00',
    updatedAt: '2026-10-13T03:25:01+00:00',
    visitDay: TODAY,
  });

const dayRow = (over: Record<string, unknown> = {}) =>
  fromWorkDayRow({
    id: '55555555-5555-4555-8555-555555555501',
    organisation_id: '55555555-5555-4555-8555-5555555555aa',
    mr_id: MR,
    territory_id: null,
    work_date: TODAY,
    time_zone: 'Asia/Kolkata',
    opened_at: '2026-10-13T03:25:00+00:00',
    opened_via: 'check_in',
    client_opened_at: '2026-10-13T03:24:50+00:00',
    open_request_id: null,
    closed_at: null,
    close_request_id: null,
    client_closed_at: null,
    closing_note: null,
    visits_total: null,
    visits_completed: null,
    visits_not_met: null,
    visits_missed: null,
    visits_unplanned: null,
    check_in_count: null,
    distance_metres: null,
    samples_quantity: null,
    inputs_quantity: null,
    reopen_count: 0,
    created_at: '2026-10-13T03:25:00+00:00',
    updated_at: '2026-10-13T03:25:00+00:00',
    ...over,
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner(MR);
  mockSendWorkDay.mockClear();
  mockRefresh.mockClear();
  mockVisits = [visit('completed')];
  mockDays = [dayRow()];
  mockSend = () => Promise.resolve({ receivedAt: '2026-10-13T12:52:01Z', warnings: [] });
});

describe('FE-W80 — End my day', () => {
  it('an open day shows the SERVER’s start time and offers the button', async () => {
    await render(<DayEnd />);
    expect(await screen.findByText('Your day is open — started 08:55')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End my day' })).toBeTruthy();
  });

  it('is SHUT while a visit is checked in, and says why — nothing is sent', async () => {
    mockVisits = [visit('in_progress')];
    await render(<DayEnd />);
    expect(
      await screen.findByText(
        'A visit is still checked in. Check out of it first, then end your day.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('End my day'));
    expect(mockSendWorkDay).not.toHaveBeenCalled();
  });

  it('with signal: queued, sent as a CLOSE of the server’s day with the note, and the pull asked for', async () => {
    await render(<DayEnd />);
    await screen.findByText('End my day');
    await fireEvent.changeText(screen.getByLabelText('Note for your manager'), ' Car broke down ');
    await fireEvent.press(screen.getByText('End my day'));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockSendWorkDay).toHaveBeenCalledWith({
      id: '66666666-6666-4666-8666-666666666601',
      action: 'close',
      workDate: TODAY,
      occurredAt: expect.any(String),
      note: 'Car broke down',
    });
    const load = await loadQueueState();
    if (load.kind !== 'loaded') throw new Error('queue unreadable');
    expect(load.state.items).toHaveLength(1);
    expect(load.state.items[0]).toMatchObject({ entity: 'work_day', status: 'synced' });
    // Accepted, and the pull that brings the server's stamp has not landed: said as such.
    expect(await screen.findByText('Ending your day — the server has it')).toBeTruthy();
  });

  it('no signal: the end is on the PHONE and waiting — never presented as the server’s', async () => {
    mockSend = () => Promise.reject(new Error('Network request failed'));
    await render(<DayEnd />);
    await screen.findByText('End my day');
    await fireEvent.press(screen.getByText('End my day'));

    expect(await screen.findByText('Ended on this phone — waiting to send')).toBeTruthy();
    expect(screen.queryByText(/Day ended at/u)).toBeNull();
    expect(screen.queryByRole('button', { name: 'End my day' })).toBeNull();
    const load = await loadQueueState();
    if (load.kind !== 'loaded') throw new Error('queue unreadable');
    expect(load.state.items[0]).toMatchObject({ entity: 'work_day', status: 'queued' });
  });

  it('a REFUSAL is said on the card with its remedy, and the button is offered again', async () => {
    mockSend = () =>
      Promise.reject(
        new SyncPushRefusal({
          message: 'work_day_has_open_visit: 1 visit(s) on 2026-10-13 are still checked in',
          sqlState: '45016',
          rejectionCode: 'internal_error',
          deadLettered: false,
        }),
      );
    await render(<DayEnd />);
    await screen.findByText('End my day');
    await fireEvent.press(screen.getByText('End my day'));

    expect(await screen.findByText('Your day was not ended')).toBeTruthy();
    expect(screen.getByText(/Check out of it, then end your day again/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End my day' })).toBeTruthy();
  });

  it('a day the SERVER has ended shows the server’s time and offers nothing', async () => {
    mockDays = [
      dayRow({
        closed_at: '2026-10-13T12:52:00+00:00',
        close_request_id: '66666666-6666-4666-8666-666666666601',
        client_closed_at: '2026-10-13T12:51:58+00:00',
        visits_total: 1,
        visits_completed: 1,
        visits_not_met: 0,
        visits_missed: 0,
        visits_unplanned: 0,
        check_in_count: 1,
        distance_metres: 0,
        samples_quantity: 0,
        inputs_quantity: 0,
        updated_at: '2026-10-13T12:52:00+00:00',
      }),
    ];
    await render(<DayEnd />);
    expect(await screen.findByText('Day ended at 18:22')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'End my day' })).toBeNull();
  });
});
