import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { OemBatteryScreen } from './OemBatteryScreen';

/**
 * **FE-D12 item 5.** The design offers "Show me a 20-second video" on the battery screens, and no
 * video exists. The control rendered as a disabled PRIMARY-sized button reading "20-second video —
 * not recorded yet": in a walkthrough, the biggest thing on the screen was an apology for a
 * missing asset. It is hidden until a video exists. The path is kept whole -- `videoAvailable`
 * plus `onWatchVideo` still render a working button -- so shipping the asset needs no new code.
 */
const base = {
  skin: 'Android',
  headline: 'Stop Android putting this app to sleep.',
  consequence: 'If the phone sleeps the app, your check-ins stop.',
  steps: [],
  onToggleDone: () => undefined,
  onContinue: () => undefined,
};

describe('A5-A8 — the 20-second video (FE-D12 item 5)', () => {
  it('shows nothing about a video while there is none', async () => {
    await render(<OemBatteryScreen {...base} />);
    expect(screen.queryByText(/20-second video/u)).toBeNull();
    expect(screen.queryByText(/once it has been recorded/u)).toBeNull();
    // The screen's own action is still there.
    expect(screen.getByText('Continue')).toBeTruthy();
  });

  it('shows a working "Show me a 20-second video" once one exists', async () => {
    const onWatchVideo = jest.fn();
    await render(<OemBatteryScreen {...base} onWatchVideo={onWatchVideo} videoAvailable />);
    await fireEvent.press(screen.getByText('Show me a 20-second video'));
    expect(onWatchVideo).toHaveBeenCalledTimes(1);
  });

  it('keeps the placeholder path: showPendingVideo brings back the disabled, honest label', async () => {
    await render(<OemBatteryScreen {...base} showPendingVideo />);
    expect(screen.getByText('20-second video — not recorded yet')).toBeTruthy();
  });
});
