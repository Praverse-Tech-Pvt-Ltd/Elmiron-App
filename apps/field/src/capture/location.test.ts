import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MR-28 C2 — `takeFix` answers, or it does not return at all.
 *
 * The sweep for discarded outcomes found `void takeFix().then(...)` on
 * `app/onboarding/location.tsx` with no `.catch`, and then found that `takeFix` COULD
 * reject: `requestForegroundPermissionsAsync` sat outside the try. So the one screen whose
 * whole purpose is the sentence *"Location is on"* could be pressed and say nothing.
 *
 * The fix is here rather than at the call site, and these cases are what makes that
 * fixable-once claim true: `takeFix` returns a `FixOutcome` for every way the phone can
 * fail. A `.catch` per caller would be the same rule written twice, and the second copy is
 * the one nobody adds — which is exactly what happened.
 */

const mockRequest = vi.fn<() => Promise<{ granted: boolean }>>();
const mockPosition = vi.fn<
  () => Promise<{
    coords: { latitude: number; longitude: number; accuracy: number };
    timestamp: number;
  }>
>();

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => mockRequest(),
  getCurrentPositionAsync: async () => mockPosition(),
  Accuracy: { Balanced: 3 },
}));

const { takeFix } = await import('./location');

beforeEach(() => {
  mockRequest.mockReset();
  mockPosition.mockReset();
});

describe('takeFix never rejects — every failure is an OUTCOME', () => {
  it('a REJECTED permission request is `unavailable`, not a thrown error', async () => {
    // The defect, stated as a case. Before the fix this rejected and the onboarding
    // screen's `.then` never ran.
    mockRequest.mockRejectedValue(new Error('Location services are not linked'));

    const outcome = await takeFix();

    expect(outcome.kind).toBe('unavailable');
    // The phone's own words, so an MR reading the screen has something to act on rather
    // than a generic sentence that fits every failure equally badly.
    expect(outcome.kind === 'unavailable' ? outcome.reason : null).toContain('not linked');
  });

  it('a DENIED permission is `denied`, which is a different thing from unavailable', async () => {
    // The distinction the screen is built on: denied means the MR said no and can say yes
    // later; unavailable means the phone could not answer. Collapsing them would tell
    // somebody to change a setting they already changed.
    mockRequest.mockResolvedValue({ granted: false });

    const outcome = await takeFix();

    expect(outcome.kind).toBe('denied');
    expect(mockPosition).not.toHaveBeenCalled();
  });

  it('a REJECTED position read is `unavailable`', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockPosition.mockRejectedValue(new Error('no GPS signal'));

    const outcome = await takeFix();

    expect(outcome.kind).toBe('unavailable');
  });

  it('THE POSITIVE CONTROL: a good read still returns the coordinates', async () => {
    // Without this, moving the permission call inside the try could have swallowed the
    // success path too and every case above would still pass.
    mockRequest.mockResolvedValue({ granted: true });
    mockPosition.mockResolvedValue({
      coords: { latitude: 18.5204, longitude: 73.8567, accuracy: 8 },
      timestamp: Date.parse('2026-09-11T09:00:00.000Z'),
    });

    const outcome = await takeFix();

    expect(outcome.kind).toBe('fix');
    expect(outcome.kind === 'fix' ? outcome.coordinates.latitude : null).toBe(18.5204);
    expect(outcome.kind === 'fix' ? outcome.coordinates.capturedAt : null).toBe(
      '2026-09-11T09:00:00.000Z',
    );
  });

  it('a TIMED-OUT read is `unavailable` and says the phone was too slow', async () => {
    // The race the module already had. Asserted here because the try now wraps more than
    // it used to, and "everything returns unavailable" would satisfy three cases above
    // while being wrong.
    mockRequest.mockResolvedValue({ granted: true });
    mockPosition.mockImplementation(() => new Promise<never>(() => undefined));

    const outcome = await takeFix(5);

    expect(outcome.kind).toBe('unavailable');
    expect(outcome.kind === 'unavailable' ? outcome.reason : null).toContain('in time');
  });
});
