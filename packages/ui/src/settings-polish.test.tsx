import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { OemBatteryScreen } from './OemBatteryScreen';
import { PasswordField } from './PasswordField';
import { SettingsScreen } from './SettingsScreen';
import { SwitchRow } from './SwitchRow';
import { TransparencyScreen } from './TransparencyScreen';

/** Handover polish, round 2 — Me, sign-in, Mobile data, first run and What this app records. */

const fontSizeOf = (text: string): number | undefined =>
  (StyleSheet.flatten(screen.getByText(text).props['style']) as { fontSize?: number }).fontSize;

describe('Me (FE-W192)', () => {
  it('says who is signed in under the title "Me"', async () => {
    await render(
      <SettingsScreen groups={[]} signedInAs="Signed in as Asha Patil · asha@example.in" />,
    );
    expect(screen.getByText('Me')).toBeTruthy();
    expect(screen.getByText('Signed in as Asha Patil · asha@example.in')).toBeTruthy();
  });

  it('shows a setting’s position beside its way in, so the row says On or Off', async () => {
    await render(
      <SettingsScreen
        groups={[
          {
            heading: 'Your data',
            rows: [
              {
                id: 'wifi-only',
                title: 'Send audio on WiFi only',
                detail: 'Recordings wait for WiFi.',
                state: 'available',
                onPress: () => undefined,
                value: 'On',
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('›')).toBeTruthy();
  });
});

describe('Mobile data (FE-W192)', () => {
  it('says On or Off on the switch’s own line, beside the track rather than under it', async () => {
    await render(
      <SwitchRow title="Send audio on WiFi only" value onValueChange={() => undefined} />,
    );
    const word = screen.getByText('On');
    const control = word.parent?.parent;
    const style = StyleSheet.flatten(control?.props['style']) as { flexDirection?: string };
    expect(style.flexDirection).toBe('row');
  });
});

describe('sign-in password (FE-W192)', () => {
  it('shows and hides what was typed, and is off each time it opens', async () => {
    await render(
      <PasswordField label="Password" value="hunter22" onChangeText={() => undefined} />,
    );
    const field = screen.getByLabelText('Password');
    expect(field.props['secureTextEntry']).toBe(true);

    const toggle = screen.getByRole('switch', { name: 'Show password' });
    expect(toggle.props['accessibilityState']).toEqual({ checked: false });
    await fireEvent.press(toggle);
    expect(screen.getByLabelText('Password').props['secureTextEntry']).toBe(false);
    expect(screen.getByText('Hide password')).toBeTruthy();
  });

  it('is at least the tap floor', async () => {
    await render(<PasswordField label="Password" value="" onChangeText={() => undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Show password' });
    const style = toggle.props['style'] as unknown;
    const resolved = StyleSheet.flatten(
      typeof style === 'function'
        ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
        : style,
    ) as { minHeight?: number };
    expect(resolved.minHeight).toBeGreaterThanOrEqual(tokens.target.floor);
  });
});

describe('What this app records (FE-W186, FE-W189, FE-W192)', () => {
  it('sets each row’s sentences at the prose step and says plainly what is off', async () => {
    await render(
      <TransparencyScreen
        entries={[
          {
            title: 'Recordings — only if a doctor agrees',
            detail: 'Only after the doctor agrees on screen, each time.',
            state: 'not-yet',
          },
        ]}
        neverRecorded="Never."
        stepLine="Step 4 of 4"
      />,
    );
    expect(fontSizeOf('Only after the doctor agrees on screen, each time.')).toBe(
      tokens.typography.secondary.size,
    );
    expect(screen.getByText('Not switched on for your company yet.')).toBeTruthy();
    expect(screen.queryByText(/this app cannot do this today/u)).toBeNull();
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
  });
});

describe('battery and autostart (FE-W192)', () => {
  const base = {
    headline: 'Stop Android putting this app to sleep.',
    consequence: 'If the phone sleeps the app, your check-ins stop.',
    steps: [],
    onToggleDone: () => undefined,
    onContinue: () => undefined,
  };

  it('names no skin on the generic screen — no "Android" eyebrow', async () => {
    await render(<OemBatteryScreen {...base} skin="" />);
    expect(screen.queryByText('Android')).toBeNull();
  });

  it('still names a phone maker’s skin, which the rep’s phone itself uses', async () => {
    await render(<OemBatteryScreen {...base} skin="MIUI / HyperOS" />);
    expect(screen.getByText('MIUI / HyperOS')).toBeTruthy();
  });

  it('opened from Me: a Back and a Done; in first run: the step line', async () => {
    const onBack = jest.fn();
    await render(<OemBatteryScreen {...base} skin="" onBack={onBack} continueLabel="Done" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Done')).toBeTruthy();
  });
});
