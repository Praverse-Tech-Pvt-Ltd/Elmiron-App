import { describe, expect, it } from 'vitest';
import { requestLocationPermission } from './location-permission';
import { asAndroidResult } from './os-permission-answer';

/** `FE-W161` — iOS answers, read the way first run reads Android's. */
describe('asAndroidResult', () => {
  it('granted is granted, whether or not it could be asked again', () => {
    expect(asAndroidResult({ granted: true, canAskAgain: true })).toBe('granted');
    expect(asAndroidResult({ granted: true, canAskAgain: false })).toBe('granted');
  });

  it('not granted but askable is a plain denial', () => {
    expect(asAndroidResult({ granted: false, canAskAgain: true })).toBe('denied');
  });

  it('not granted and not askable is never_ask_again — iOS after "Don\'t Allow"', () => {
    expect(asAndroidResult({ granted: false, canAskAgain: false })).toBe('never_ask_again');
  });

  it('through the location rule: an iOS refusal opens settings, as Android\'s "Don\'t ask again" does', async () => {
    const answer = asAndroidResult({ granted: false, canAskAgain: false });
    await expect(
      requestLocationPermission({
        requestMultiple: ([fine, coarse]) => Promise.resolve({ [fine]: answer, [coarse]: answer }),
      }),
    ).resolves.toBe('blocked');
  });
});
