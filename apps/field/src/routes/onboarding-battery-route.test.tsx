import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { OemFamily } from '../onboarding/oem';
import type { SettingsLauncher } from '../onboarding/launch';

/**
 * A5-A8 rendered, with the emphasis on the state that will actually ship: **no
 * shortcut resolves and the numbered steps carry the whole flow.**
 *
 * The launcher is mocked at the device boundary rather than at `Linking`, because the
 * boundary is the seam the design put there — `src/onboarding/device.ts` is the only
 * file that touches Android, and everything above it is supposed to be drivable from
 * a test. If that stopped being true these mocks would get harder, which is the
 * signal.
 */

const mockDetect = jest.fn<() => OemFamily>();

/** A device that resolves nothing and throws on every launch. The default case. */
const unresolvable: SettingsLauncher = {
  probe: () => Promise.resolve(false),
  launch: () => Promise.reject(new Error('ActivityNotFoundException')),
};

/** A device that resolves and opens everything. Rare, and useful for one assertion. */
const permissive: SettingsLauncher = {
  probe: () => Promise.resolve(true),
  launch: () => Promise.resolve(),
};

// Typed as the port, not inferred: `Promise.reject` alone narrows `launch` to
// `Promise<never>` and the permissive double then does not fit the slot.
const mockLauncher: { current: SettingsLauncher } = { current: unresolvable };

jest.mock('../onboarding/device', () => ({
  detectDeviceOem: () => mockDetect(),
  get deviceLauncher() {
    return mockLauncher.current;
  },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

import BatterySetup from '../../app/onboarding/battery';

const FAMILIES: readonly OemFamily[] = ['xiaomi', 'oppo', 'vivo', 'realme', 'unknown'];

describe('A5-A8 — the fallback path, with zero working intents', () => {
  it.each(FAMILIES)(
    'renders %s usefully when nothing resolves and throws nothing',
    async (family) => {
      // THE TEST THIS SPRINT CARES ABOUT MOST.
      //
      // Every vendor intent is unresolvable and every launch rejects with the exception
      // that crashes a naive implementation. The screen must still be the whole
      // instruction set, and the render must not throw.
      mockDetect.mockReturnValue(family);
      mockLauncher.current = unresolvable;

      await render(<BatterySetup />);

      // The steps are present and numbered.
      expect(screen.getByText('1.')).toBeTruthy();
      expect(screen.getByText('2.')).toBeTruthy();

      // Every step is markable, so the MR can keep their place while working by hand.
      expect(screen.getAllByText('Mark done').length).toBeGreaterThanOrEqual(2);

      // And no shortcut button is offered, because none of them would work.
      expect(screen.queryByText('Open that settings screen')).toBeNull();
    },
  );

  it('shows the Xiaomi steps and the consequence, not a generic message', async () => {
    mockDetect.mockReturnValue('xiaomi');
    mockLauncher.current = unresolvable;
    await render(<BatterySetup />);

    expect(screen.getByText('Xiaomi will shut this app off. Two taps stops it.')).toBeTruthy();
    expect(
      screen.getByText(
        "If MIUI closes the app, your check-ins and mileage stop and you'll be entering them by hand.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Autostart')).toBeTruthy();
    expect(screen.getByText('Battery saver → No restrictions')).toBeTruthy();
    expect(screen.getByText('Lock the app in Recents')).toBeTruthy();
  });

  it("keeps the vendor's own wording so the MR can tell they are on the right screen", async () => {
    mockDetect.mockReturnValue('vivo');
    mockLauncher.current = unresolvable;
    await render(<BatterySetup />);
    expect(
      screen.getByText(
        "What you'll see: High background power use. Switch it on, then press back twice.",
      ),
    ).toBeTruthy();
  });

  it('sends a Realme device to A8, never to the ColorOS screen', async () => {
    // The detection trap, checked at the screen rather than only in the unit test:
    // this is where a regression would actually be seen by an MR.
    mockDetect.mockReturnValue('realme');
    mockLauncher.current = unresolvable;
    await render(<BatterySetup />);

    expect(screen.getByText('Two settings, same screen. Quickest of the four.')).toBeTruthy();
    expect(screen.queryByText('ColorOS is the strictest of the four.')).toBeNull();
    expect(screen.queryByText('Sleep standby optimisation → off')).toBeNull();
  });

  it('gives an unknown device generic guidance rather than a dead end', async () => {
    mockDetect.mockReturnValue('unknown');
    mockLauncher.current = unresolvable;
    await render(<BatterySetup />);
    expect(screen.getByText('Stop Android putting this app to sleep.')).toBeTruthy();
  });
});

describe('A5-A8 — the shortcut, when the device does resolve one', () => {
  it('offers the button only for intents this build can express', async () => {
    mockDetect.mockReturnValue('xiaomi');
    mockLauncher.current = permissive;

    await render(<BatterySetup />);

    // Xiaomi declares three intents. One is a component target, which this build
    // cannot form, so at most two buttons appear — never three.
    const buttons = screen.queryAllByText('Open that settings screen');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(3);
  });

  it('never attaches a shortcut to the component-only Autostart step', async () => {
    mockDetect.mockReturnValue('oppo');
    mockLauncher.current = permissive;

    await render(<BatterySetup />);
    // Auto-launch is the ColorOS component intent. Its step still renders; its button
    // does not, because pressing it could only fail.
    expect(screen.getByText('Auto-launch')).toBeTruthy();
    expect(screen.queryAllByText('Open that settings screen').length).toBeLessThan(3);
  });
});

describe('A5-A8 — the video that does not exist', () => {
  it('renders the control disabled with an honest label, never a working-looking one', async () => {
    mockDetect.mockReturnValue('xiaomi');
    mockLauncher.current = unresolvable;
    await render(<BatterySetup />);

    // No asset exists and there is no third-party link. A dead button that looks live
    // is the thing being avoided; the label says why it is off.
    expect(screen.getByText('20-second video — not recorded yet')).toBeTruthy();
    expect(screen.queryByText('Show me a 20-second video')).toBeNull();
  });
});
