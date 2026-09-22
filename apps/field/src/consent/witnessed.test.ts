import { beforeEach, describe, expect, it, vi } from 'vitest';

const disk = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(disk.get(key) ?? null),
    setItem: (key: string, value: string) => {
      disk.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      disk.delete(key);
      return Promise.resolve();
    },
    multiRemove: () => Promise.resolve(),
  },
}));

import { setQueueOwner } from '../sync/async-storage-store';
import {
  WITNESSED_KEY,
  describeWitnessed,
  recordWitnessedConsent,
  witnessedConsentFor,
} from './witnessed';
import type { WitnessedConsent } from './witnessed';

/**
 * MR-49 C — `FE-W55`. The visit screen says what THIS PHONE witnessed about the doctor's answer,
 * for the signed-in MR and this visit only, and says nothing either way when it witnessed nothing.
 */
const V = '66666666-6666-4666-8666-666666666601';
const W = '66666666-6666-4666-8666-666666666602';

const answer = (over: Partial<WitnessedConsent> = {}): WitnessedConsent => ({
  visitId: V,
  outcome: 'declined',
  capturedAt: '2026-09-21T06:22:00.000Z',
  syncItemId: '77777777-7777-4777-8777-777777777701',
  ...over,
});

const clock = (iso: string): string => iso.slice(11, 16);

beforeEach(() => {
  disk.clear();
});

describe('C3 — scoped to the signed-in MR and the visit', () => {
  it('POSITIVE CONTROL: the MR who captured it sees it', async () => {
    setQueueOwner('rep-a');
    await recordWitnessedConsent(answer());
    expect((await witnessedConsentFor(V))?.outcome).toBe('declined');
  });

  it('a DIFFERENT MR on the same phone does not see the previous MR’s answer', async () => {
    setQueueOwner('rep-a');
    await recordWitnessedConsent(answer());
    setQueueOwner('rep-b');
    expect(await witnessedConsentFor(V)).toBeNull();
    expect([...disk.keys()]).toEqual([WITNESSED_KEY('rep-a')]);
  });

  it('an answer for one visit is not shown on another', async () => {
    setQueueOwner('rep-a');
    await recordWitnessedConsent(answer());
    expect(await witnessedConsentFor(W)).toBeNull();
  });

  it('the latest answer this phone witnessed for the visit wins', async () => {
    setQueueOwner('rep-a');
    await recordWitnessedConsent(answer());
    await recordWitnessedConsent(
      answer({ outcome: 'consented', capturedAt: '2026-09-21T06:30:00.000Z' }),
    );
    expect((await witnessedConsentFor(V))?.outcome).toBe('consented');
  });

  it('with no one signed in, nothing is written or read', async () => {
    setQueueOwner(null);
    await recordWitnessedConsent(answer());
    expect(disk.size).toBe(0);
    expect(await witnessedConsentFor(V)).toBeNull();
  });
});

describe('C1/C2 — what the screen says', () => {
  const item = (status: string) => [{ id: answer().syncItemId, status } as never];

  it('a SENT decline is stated as given, with the device time', () => {
    expect(describeWitnessed(answer(), [], clock)).toBe(
      'The doctor said no to recording, on this phone at 06:22.',
    );
  });

  it('a QUEUED answer says it is waiting to send', () => {
    expect(describeWitnessed(answer({ outcome: 'consented' }), item('queued'), clock)).toBe(
      'The doctor agreed to recording, on this phone at 06:22. Waiting to send.',
    );
  });

  it('an answer the queue gave up on says it was not accepted', () => {
    expect(describeWitnessed(answer(), item('failed'), clock)).toMatch(/did not accept it/u);
  });

  it('NEUTRAL when nothing was witnessed: claims neither that the doctor was asked nor not', () => {
    const text = describeWitnessed(null, [], clock);
    expect(text).toBe('This phone does not have the doctor’s answer for this visit.');
    // The sentence FE-W55 was about, and any claim either way, are absent.
    expect(text).not.toMatch(/ask the doctor|agreed|said no|never asked/iu);
  });
});
