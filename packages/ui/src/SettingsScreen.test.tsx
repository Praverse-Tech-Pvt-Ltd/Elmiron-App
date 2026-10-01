import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { SettingsScreen } from './SettingsScreen';
import type { SettingsScreenProps } from './SettingsScreen';

const groups = (onPress: () => void = () => undefined): SettingsScreenProps['groups'] => [
  {
    heading: 'Your data',
    rows: [
      {
        id: 'wifi-only',
        title: 'Send audio on WiFi only',
        detail: 'Recordings wait for WiFi. Everything else still sends.',
        state: 'not-yet',
      },
    ],
  },
  {
    heading: 'This phone',
    rows: [
      {
        id: 'transparency',
        title: 'What this app records',
        detail: 'Everything, before you ask.',
        state: 'available',
        onPress,
      },
    ],
  },
];

describe('a setting that governs nothing says so', () => {
  it('marks an unbuilt control rather than offering it', async () => {
    // The failure this prevents: an MR flips "WiFi only", believes their recordings
    // will wait for WiFi, and spends their own data plan on that belief.
    await render(<SettingsScreen groups={groups()} />);
    expect(
      screen.getByText('Not yet — this setting does not control anything in this build.'),
    ).toBeTruthy();
  });

  it('does not attach that line to a control that works', async () => {
    await render(<SettingsScreen groups={groups()} />);
    expect(
      screen.getAllByText('Not yet — this setting does not control anything in this build.').length,
    ).toBe(1);
  });

  it('leaves an unbuilt control unpressable', async () => {
    // Nothing to press means nothing to misread as having taken effect.
    await render(<SettingsScreen groups={groups()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1);
  });
});

describe('the settings that do work', () => {
  it('opens the screen behind an available row', async () => {
    const onPress = jest.fn();
    await render(<SettingsScreen groups={groups(onPress)} />);
    await fireEvent.press(screen.getByText('What this app records'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('groups rows under their headings', async () => {
    await render(<SettingsScreen groups={groups()} />);
    expect(screen.getByText('Your data')).toBeTruthy();
    expect(screen.getByText('This phone')).toBeTruthy();
  });
});

describe('what the screen does not claim', () => {
  it('shows no data-usage figures, because nothing measures them', async () => {
    // C4 opens with "84 MB of your plan". Those are the numbers an MR reads before
    // deciding whether to turn WiFi-only on, which makes them the worst possible
    // place for a plausible guess.
    await render(<SettingsScreen groups={groups()} />);
    expect(screen.queryByText(/MB/u)).toBeNull();
  });
});

/**
 * **FE-D12 V5.** FE-D7 4 moved every screen title to `Title` (Today, Today's route, Your report,
 * Day end) and missed this one. On the Me tab, where Sign out lives, "Settings" was drawn at the
 * section-heading size, a step below every other screen title the demo shows.
 */
describe('the screen title (FE-D12 V5)', () => {
  it('is drawn at the day-screen title size, like every other screen title', async () => {
    await render(<SettingsScreen groups={groups()} />);
    const title = StyleSheet.flatten(screen.getByText('Settings').props['style']) as {
      fontSize?: number;
    };
    expect(title.fontSize).toBe(tokens.typography.title.size);
  });
});
