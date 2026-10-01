import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * **FE-D12 item 3 — a sent report cannot be sent again.**
 *
 * On the Pixel 10, after "Report sent" the screen kept "Send the report" enabled, with the text
 * still in the fields. A second press made a second report with a new id: the manager would see
 * the same visit reported twice. After a report is sent -- or saved to the queue, which will send
 * it by itself -- the button gives way to the sent state. A report that did NOT land (refused,
 * the queue unreadable, a thrown error) keeps the button, because the rep must be able to try
 * again: that is what the failure banner tells them to do.
 */

type Outcome =
  | { kind: 'sent' }
  | { kind: 'queued' }
  | { kind: 'refused'; message: string }
  | { kind: 'queue_unreadable' };

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
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import CallReport from '../../app/report/[visitId]';

const writeAndSend = async (): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('What happened'), 'Discussed the dosing guide.');
  await fireEvent.press(screen.getByText('Send the report'));
};

beforeEach(() => {
  mockSendOrQueue.mockReset();
});

describe('FE-D12 item 3 — the call report sends once', () => {
  const landed: [kind: 'sent' | 'queued', title: string][] = [
    ['sent', 'Report sent'],
    ['queued', 'Report saved'],
  ];
  it.each(landed)(
    'after it is %s, there is no "Send the report" to press again',
    async (kind, title) => {
      mockSendOrQueue.mockResolvedValue({ kind });
      await render(<CallReport />);
      await writeAndSend();

      expect(await screen.findByText(title)).toBeTruthy();
      expect(screen.queryByText('Send the report')).toBeNull();
      expect(screen.queryByText('Sending…')).toBeNull();
      expect(mockSendOrQueue).toHaveBeenCalledTimes(1);
    },
  );

  it('after it is refused, the button stays, and a retry sends again', async () => {
    mockSendOrQueue.mockResolvedValueOnce({ kind: 'refused', message: 'Outside the shift.' });
    mockSendOrQueue.mockResolvedValueOnce({ kind: 'sent' });
    await render(<CallReport />);
    await writeAndSend();

    expect(await screen.findByText('That was refused')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Send the report')).toBeTruthy();
    });
    await fireEvent.press(screen.getByText('Send the report'));

    expect(await screen.findByText('Report sent')).toBeTruthy();
    expect(mockSendOrQueue).toHaveBeenCalledTimes(2);
  });

  it('after the queue could not be written, the button stays for a retry', async () => {
    mockSendOrQueue.mockResolvedValue({ kind: 'queue_unreadable' });
    await render(<CallReport />);
    await writeAndSend();

    expect(await screen.findByText('This was NOT saved')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Send the report')).toBeTruthy();
    });
  });
});
