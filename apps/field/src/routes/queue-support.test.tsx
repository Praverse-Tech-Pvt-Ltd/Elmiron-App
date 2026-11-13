import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SyncQueueItemSchema } from '@fieldforce/core';
import { emptyQueue, syncQueueReducer } from '../sync/reducer';
import type { SyncEvent } from '../sync/events';

/**
 * `FE-W195` — "Tell the help desk" on Saved on this phone. It exists only when the build names a
 * help desk (`EXPO_PUBLIC_SUPPORT_EMAIL` / `_PHONE`, read in `features.ts`), and then it opens the
 * phone's mail app with the queue's references already in the message. Unset: no button — the
 * screen's rule since S3, "absent until there is a help desk to tell".
 *
 * Also `FE-W191`: "Last sent at …" under "Everything is sent", from the server's delivery stamp.
 */
jest.mock('../api', () => ({ createClientForScenario: () => ({}) }));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({}),
}));
const mockLoadQueueState = jest.fn<() => Promise<unknown>>();
jest.mock('../sync/async-storage-store', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/async-storage-store'),
  loadQueueState: () => mockLoadQueueState(),
}));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({ zone: { timeZone: 'Asia/Kolkata', source: 'territory' } }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockSupport: { email: string | null; phone: string | null } = { email: null, phone: null };
// Getters, defined rather than spread: a spread would read them once, at import, before any test
// has said what the build carries.
jest.mock('../features', () =>
  Object.defineProperties(
    { ...jest.requireActual<Record<string, unknown>>('../features') },
    {
      supportEmail: { enumerable: true, get: () => mockSupport.email },
      supportPhone: { enumerable: true, get: () => mockSupport.phone },
    },
  ),
);

import Queue from '../../app/queue';

const ITEM = '15151515-1515-4515-8515-151515151501';
const item = SyncQueueItemSchema.parse({
  id: ITEM,
  entity: 'call_report',
  operation: 'create',
  entityId: '15151515-1515-4515-8515-1515151515aa',
  payload: {},
  status: 'queued',
  attemptCount: 0,
  lastError: null,
  clientCreatedAt: '2026-08-17T09:00:00.000Z',
  syncedAt: null,
});

/** A call report the server refused for good, with a reference to quote. */
const refused = (): unknown => {
  const events: SyncEvent[] = [
    { type: 'enqueued', item },
    {
      type: 'verdict_received',
      verdict: {
        id: ITEM,
        status: 'rejected',
        rejectionCode: 'validation_failed',
        sqlState: null,
        explanation: null,
        warnings: [],
        attemptsRemaining: 0,
        receivedAt: '2026-08-17T11:22:33.000Z',
      },
    },
  ];
  return { kind: 'loaded', state: events.reduce(syncQueueReducer, emptyQueue) };
};

const openURL = jest.spyOn(Linking, 'openURL');

beforeEach(() => {
  mockSupport.email = null;
  mockSupport.phone = null;
  openURL.mockReset();
  openURL.mockResolvedValue(true);
});

describe('FE-W195 — the help desk', () => {
  it('unset: no "Tell the help desk", however stuck the queue is', async () => {
    mockLoadQueueState.mockResolvedValue(refused());
    await render(<Queue />);
    expect(await screen.findByText('Call report')).toBeTruthy();
    expect(screen.queryByText('Tell the help desk')).toBeNull();
  });

  it('an address: opens a message to it carrying the reference and the item', async () => {
    mockSupport.email = 'help@example.com';
    mockLoadQueueState.mockResolvedValue(refused());
    await render(<Queue />);
    await fireEvent.press(await screen.findByText('Tell the help desk'));

    expect(openURL).toHaveBeenCalledTimes(1);
    const link = String(openURL.mock.calls[0]?.[0]);
    expect(link).toMatch(/^mailto:help@example\.com\?/u);
    const body = new URL(link).searchParams.get('body') ?? '';
    expect(body).toContain('Call report');
    expect(body).toContain('validation_failed');
    expect(body).toContain(ITEM);
  });

  it('only a number: dials it', async () => {
    mockSupport.phone = '+91 20 1234 5678';
    mockLoadQueueState.mockResolvedValue(refused());
    await render(<Queue />);
    await fireEvent.press(await screen.findByText('Tell the help desk'));
    expect(openURL).toHaveBeenCalledWith('tel:+912012345678');
  });
});

describe('FE-W191 — when everything was last sent', () => {
  it('says the server’s time, in the territory’s clock', async () => {
    const sent = SyncQueueItemSchema.parse({
      ...item,
      status: 'synced',
      // 11:22Z is 16:52 in IST.
      syncedAt: '2026-08-17T11:22:33.000Z',
    });
    mockLoadQueueState.mockResolvedValue({
      kind: 'loaded',
      state: { ...emptyQueue, items: [sent] },
    });
    await render(<Queue />);
    expect(await screen.findByText('Everything is sent')).toBeTruthy();
    expect(screen.getByText('Last sent at 16:52.')).toBeTruthy();
  });

  it('says nothing about a time the server never stamped', async () => {
    mockLoadQueueState.mockResolvedValue({ kind: 'loaded', state: emptyQueue });
    await render(<Queue />);
    expect(await screen.findByText('Everything is sent')).toBeTruthy();
    expect(screen.queryByText(/Last sent/u)).toBeNull();
  });
});
