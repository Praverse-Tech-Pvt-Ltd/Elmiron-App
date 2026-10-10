import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * `BE-W175` — the call report names products from the company's catalogue, and only their ids
 * leave the phone: through the outbox, so a report written with no signal keeps them.
 *
 * The outbox is mocked at `sendOrQueue`, so what is asserted is exactly the item the phone would
 * queue (`callReportQueueItem`, real) -- the same item `sync_push` receives later.
 */

type Outcome = { kind: 'sent' } | { kind: 'queued' };
const mockSendOrQueue = jest.fn<(send: () => unknown, item: unknown) => Promise<Outcome>>();
jest.mock('../sync/outbox', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/outbox'),
  sendOrQueue: (send: () => unknown, item: unknown) => mockSendOrQueue(send, item),
}));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createCallReport: jest.fn() }),
}));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    store: {
      visit: new Map(),
      doctor: new Map(),
      beat_plan: new Map(),
      clinic_address: new Map(),
      consent_text_version: new Map(),
    },
    status: 'ready',
    failure: null,
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    serverTime: '2026-09-21T06:00:00.000Z',
    today: '2026-09-21',
  }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

type ListKind =
  | { kind: 'fresh'; products: { id: string; label: string }[] }
  | { kind: 'cached'; products: { id: string; label: string }[]; savedAt: string }
  | { kind: 'none' };
const mockLoad = jest.fn<() => Promise<ListKind>>();
jest.mock('../catalogue/products', () => ({
  ...jest.requireActual<Record<string, unknown>>('../catalogue/products'),
  loadProductChoices: () => mockLoad(),
}));

import CallReport from '../../app/report/[visitId]';

const ACTIVEX = '11111111-1111-4111-8111-111111111111';
const KITTO = '22222222-2222-4222-8222-222222222222';
const CATALOGUE = [
  { id: ACTIVEX, label: 'Activex (activamide)' },
  { id: KITTO, label: 'Kitto' },
];

/** The payload of the one item handed to the outbox. */
const queuedPayload = (): { productIdsDiscussed: string[]; summary: string } => {
  const call = mockSendOrQueue.mock.calls[0];
  const item = call?.[1] as
    { payload: { productIdsDiscussed: string[]; summary: string } } | undefined;
  if (item === undefined) throw new Error('nothing was handed to the outbox');
  return item.payload;
};

const write = async (): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('What happened'), 'Discussed the dosing guide.');
  await fireEvent.press(screen.getByText('Send the report'));
};

beforeEach(() => {
  mockSendOrQueue.mockReset();
  mockLoad.mockReset();
});

describe('BE-W175 — products on the call report', () => {
  it('lists the catalogue, and sends exactly the ids marked, in the order marked', async () => {
    mockLoad.mockResolvedValue({ kind: 'fresh', products: CATALOGUE });
    mockSendOrQueue.mockResolvedValue({ kind: 'sent' });
    await render(<CallReport />);

    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Kitto' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Activex (activamide)' }));
    await write();

    await waitFor(() => {
      expect(mockSendOrQueue).toHaveBeenCalledTimes(1);
    });
    expect(queuedPayload().productIdsDiscussed).toEqual([KITTO, ACTIVEX]);
    // The rep's words stay separate from the list.
    expect(queuedPayload().summary).toBe('Discussed the dosing guide.');
  });

  it('un-marking a product removes it', async () => {
    mockLoad.mockResolvedValue({ kind: 'fresh', products: CATALOGUE });
    mockSendOrQueue.mockResolvedValue({ kind: 'sent' });
    await render(<CallReport />);
    const kitto = await screen.findByRole('checkbox', { name: 'Kitto' });
    await fireEvent.press(kitto);
    await fireEvent.press(kitto);
    await write();
    await waitFor(() => {
      expect(mockSendOrQueue).toHaveBeenCalledTimes(1);
    });
    expect(queuedPayload().productIdsDiscussed).toEqual([]);
  });

  it('offline: the saved list is offered, said to be the saved one, and the queued report keeps the ids', async () => {
    mockLoad.mockResolvedValue({
      kind: 'cached',
      products: CATALOGUE,
      savedAt: '2026-09-20T09:00:00.000Z',
    });
    mockSendOrQueue.mockResolvedValue({ kind: 'queued' });
    await render(<CallReport />);

    expect(
      await screen.findByText('No signal: this is the list this phone saved earlier.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Activex (activamide)' }));
    await write();

    expect(await screen.findByText('Report saved')).toBeTruthy();
    expect(queuedPayload().productIdsDiscussed).toEqual([ACTIVEX]);
  });

  it('never loaded on this phone: says so, offers none, and the report still goes', async () => {
    mockLoad.mockResolvedValue({ kind: 'none' });
    mockSendOrQueue.mockResolvedValue({ kind: 'sent' });
    await render(<CallReport />);

    expect(await screen.findByText(/has not loaded your company’s products yet/u)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await write();
    await waitFor(() => {
      expect(mockSendOrQueue).toHaveBeenCalledTimes(1);
    });
    expect(queuedPayload().productIdsDiscussed).toEqual([]);
  });
});
