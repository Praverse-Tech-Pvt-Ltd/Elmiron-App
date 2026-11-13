import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * `FE-W190`, QA 50 — the call report keeps what the rep typed.
 *
 * The report lived only in the screen's state, so Back threw it away and the rep typed it again.
 * Now it is kept per rep and visit while it is being written, restored when the report is opened
 * again, and removed once the report is sent or saved to send (`src/capture/report-draft.ts`).
 */
type Outcome = { kind: 'sent' } | { kind: 'queued' } | { kind: 'refused'; message: string };

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
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import { setQueueOwner } from '../sync/async-storage-store';
import { REPORT_DRAFT_KEY } from '../capture/report-draft';
import CallReport from '../../app/report/[visitId]';

const REP = '22222222-2222-4222-8222-2222222222aa';
const OTHER_REP = '22222222-2222-4222-8222-2222222222bb';
const VISIT = '44444444-4444-4444-8444-444444444401';
const WORDS = 'Met at the door. Asked for the dosing card.';

const summaryValue = (): unknown => screen.getByLabelText('What happened').props['value'];

/** Type, then wait until the draft is on the phone — the write is asynchronous. */
const typeSummary = async (text: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('What happened'), text);
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(REPORT_DRAFT_KEY(REP, VISIT))).toContain(text);
  });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner(REP);
  mockSendOrQueue.mockReset();
});

describe('FE-W190 — the call report keeps its draft', () => {
  it('brings back what was typed when the report is opened again', async () => {
    await render(<CallReport />);
    await typeSummary(WORDS);
    await cleanup();

    await render(<CallReport />);
    await waitFor(() => {
      expect(summaryValue()).toBe(WORDS);
    });
  });

  it('forgets it once the report is sent', async () => {
    mockSendOrQueue.mockResolvedValue({ kind: 'sent' });
    await render(<CallReport />);
    await typeSummary(WORDS);
    await fireEvent.press(screen.getByText('Send the report'));
    expect(await screen.findByText('Report sent')).toBeTruthy();

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(REPORT_DRAFT_KEY(REP, VISIT))).toBeNull();
    });
  });

  it('forgets it once the report is saved to send by itself', async () => {
    mockSendOrQueue.mockResolvedValue({ kind: 'queued' });
    await render(<CallReport />);
    await typeSummary(WORDS);
    await fireEvent.press(screen.getByText('Send the report'));
    expect(await screen.findByText('Report saved')).toBeTruthy();

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(REPORT_DRAFT_KEY(REP, VISIT))).toBeNull();
    });
  });

  it('keeps it when the server refused the report, so nothing is retyped', async () => {
    mockSendOrQueue.mockResolvedValue({ kind: 'refused', message: 'Outside the shift.' });
    await render(<CallReport />);
    await typeSummary(WORDS);
    await fireEvent.press(screen.getByText('Send the report'));
    expect(await screen.findByText('That was refused')).toBeTruthy();

    expect(await AsyncStorage.getItem(REPORT_DRAFT_KEY(REP, VISIT))).toContain(WORDS);
  });

  it('never shows one rep’s draft to another signed in on the same phone', async () => {
    await render(<CallReport />);
    await typeSummary(WORDS);
    await cleanup();

    setQueueOwner(OTHER_REP);
    await render(<CallReport />);
    // Give the read its turn; it must find nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(summaryValue()).toBe('');
  });
});
