import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * W2-C B / `BE-W159` — the ROUTE refuses on its own, whatever the screen does.
 *
 * Added after mutant BM10 (the route's guard removed) SURVIVED: the screen's disabled Send button
 * stopped every press first, so the route's check was never exercised. The screen is replaced here
 * by a probe that calls `onSend` directly — which is what a regression in the screen would do — and
 * the route must still send nothing with a phone number in the text, or with no text at all.
 */
const mockFlag = jest.fn<(body: unknown) => Promise<unknown>>();
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createAdverseEventFlag: mockFlag }),
}));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    store: { visit: new Map(), doctor: new Map() },
    status: 'ready',
    failure: null,
  }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

interface ProbeProps {
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
}
let mockProps: ProbeProps | null = null;
jest.mock('@fieldforce/ui', () => ({
  ...jest.requireActual<Record<string, unknown>>('@fieldforce/ui'),
  AdverseEventScreen: (props: ProbeProps) => {
    mockProps = props;
    return null;
  },
}));

import { setQueueOwner } from '../sync/async-storage-store';
import AdverseEventFlag from '../../app/adverse-event/[visitId]';

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner('22222222-2222-4222-8222-2222222222aa');
  mockFlag.mockReset();
  mockFlag.mockResolvedValue({ receivedAt: 'x', warnings: [] });
  mockProps = null;
});

const pressWith = async (text: string): Promise<void> => {
  await render(<AdverseEventFlag />);
  await waitFor(() => {
    expect(mockProps).not.toBeNull();
  });
  mockProps?.onTextChange(text);
  // Press only once the screen has re-rendered WITH the text -- the first draft pressed the stale
  // props (empty text), so its two "sends nothing" cases passed for the wrong reason, and only the
  // positive control below noticed.
  await waitFor(() => {
    expect(mockProps?.text).toBe(text);
  });
  mockProps?.onSend();
};

describe('app/adverse-event/[visitId].tsx — the route’s own guard', () => {
  it('sends NOTHING when the text holds a phone number, even if Send is pressed', async () => {
    await pressWith('Call the patient on 98765 43210.');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockFlag).not.toHaveBeenCalled();
  });

  it('sends NOTHING for an empty flag', async () => {
    await pressWith('   ');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockFlag).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: the same press with ordinary words does send', async () => {
    await pressWith('Rash after the second dose.');
    await waitFor(() => {
      expect(mockFlag).toHaveBeenCalledTimes(1);
    });
  });
});
