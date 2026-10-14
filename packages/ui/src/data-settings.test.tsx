import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SyncQueueItemSchema } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { DataSettingsScreen, WARN_OVER_TITLE, WIFI_ONLY_TITLE } from './DataSettingsScreen';
import { QueueScreen, rowStateFor } from './QueueScreen';
import { SwitchRow, switchTrackStyle } from './SwitchRow';

/**
 * `FE-W133` (the switch), `FE-W139` (the Mobile data screen) and `FE-W136` (audio waiting for WiFi
 * on the queue screen).
 */

describe('SwitchRow — FE-W133', () => {
  it('is ONE control with role switch, its state, and its name', async () => {
    await render(
      <SwitchRow
        title="Send audio on WiFi only"
        detail="Recordings wait."
        value
        onValueChange={() => undefined}
      />,
    );
    const control = screen.getByRole('switch');
    expect(control.props['accessibilityState']).toEqual({ checked: true, disabled: false });
    expect(control.props['accessibilityLabel']).toBe('Send audio on WiFi only. Recordings wait.');
  });

  it('a press asks for the opposite of what it shows — and moves nothing itself', async () => {
    const onValueChange = jest.fn();
    await render(<SwitchRow title="Warn me" value={false} onValueChange={onValueChange} />);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onValueChange).toHaveBeenCalledWith(true);
    // Still drawn off: the caller decides once the phone has kept it.
    expect(screen.getByRole('switch').props['accessibilityState']).toEqual({
      checked: false,
      disabled: false,
    });
  });

  it('says On or Off in words, never by position or colour alone', async () => {
    await render(<SwitchRow title="A" value onValueChange={() => undefined} />);
    expect(screen.getByText('On')).toBeTruthy();
    await render(<SwitchRow title="B" value={false} onValueChange={() => undefined} />);
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('draws on in the accent and off with a control edge, from tokens', () => {
    const on = StyleSheet.flatten(switchTrackStyle(true));
    const off = StyleSheet.flatten(switchTrackStyle(false));
    expect(on.backgroundColor).toBe(tokens.color.accent);
    expect(off.borderColor).toBe(tokens.color.border);
  });

  it('is a whole-row target at the row height, and ignores presses while disabled', async () => {
    const onValueChange = jest.fn();
    await render(<SwitchRow title="A" value onValueChange={onValueChange} disabled />);
    const control = screen.getByRole('switch');
    const style = StyleSheet.flatten(control.props['style'] as never) as { minHeight?: number };
    expect(style.minHeight).toBe(tokens.target.row);
    await fireEvent.press(control);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('the Mobile data screen — FE-W139', () => {
  const props = {
    wifiOnlyAudio: true,
    warnOverMonthly: false,
    onChange: () => undefined,
    usedThisMonth: '12.4 MB',
  };

  it('shows both switches where the phone has them', async () => {
    await render(<DataSettingsScreen {...props} />);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(switches[0]?.props['accessibilityLabel']).toContain(WIFI_ONLY_TITLE);
    expect(switches[0]?.props['accessibilityState']).toMatchObject({ checked: true });
    expect(switches[1]?.props['accessibilityLabel']).toContain(WARN_OVER_TITLE);
    expect(switches[1]?.props['accessibilityState']).toMatchObject({ checked: false });
  });

  it('reports which switch was pressed, and to what', async () => {
    const onChange = jest.fn();
    await render(<DataSettingsScreen {...props} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('switch', { name: /Warn me over 100 MB/u }));
    expect(onChange).toHaveBeenCalledWith('warnOverMonthly', true);
  });

  it('draws no switch at all until the saved values are read', async () => {
    await render(<DataSettingsScreen {...props} wifiOnlyAudio={null} />);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText('Reading your settings')).toBeTruthy();
  });

  it('labels the figure as this app’s uploads, and says what is not counted', async () => {
    await render(<DataSettingsScreen {...props} />);
    expect(screen.getByText('This app’s uploads over mobile data this month')).toBeTruthy();
    expect(screen.getByText('12.4 MB')).toBeTruthy();
    expect(
      screen.getByText(/Downloads, other apps and the phone’s own use are not counted/u),
    ).toBeTruthy();
  });

  it('claims no figure before the server has said which month it is', async () => {
    await render(<DataSettingsScreen {...props} usedThisMonth={null} />);
    expect(screen.queryByText(/^\d[\d.]* MB$/u)).toBeNull();
    expect(screen.getByText('Shown once this phone has synced today.')).toBeTruthy();
  });

  it('says when a change did not save, in attention and not critical', async () => {
    await render(<DataSettingsScreen {...props} saveFailure="Try again." />);
    expect(screen.getByText('That change was not saved')).toBeTruthy();
  });
});

const audio = (over: Partial<ReturnType<typeof SyncQueueItemSchema.parse>> = {}) =>
  SyncQueueItemSchema.parse({
    id: '16161616-1616-4616-8616-161616161601',
    entity: 'voice_note',
    operation: 'create',
    entityId: '16161616-1616-4616-8616-1616161616aa',
    payload: {},
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: '2026-10-14T09:00:00.000Z',
    syncedAt: null,
    ...over,
  });

describe('the queue screen, with audio waiting for WiFi — FE-W136', () => {
  const note = audio();
  const recording = audio({ id: '16161616-1616-4616-8616-161616161602', entity: 'recording' });

  it('says "Waiting for WiFi" on the held rows and counts them, neutrally', async () => {
    await render(
      <QueueScreen
        items={[note, recording]}
        rejections={{}}
        waitingForWifi={{ ids: [note.id, recording.id] }}
      />,
    );
    expect(screen.getAllByText('Waiting for WiFi')).toHaveLength(2);
    expect(screen.getByText('2 recordings waiting for WiFi')).toBeTruthy();
    // Waiting is never an alert.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a held row is never "Still trying" or "won’t go", whatever its old attempt count', async () => {
    const tried = audio({ attemptCount: 5 });
    expect(rowStateFor(tried, undefined, 3, true)).toBe('waiting-wifi');
    await render(
      <QueueScreen items={[tried]} rejections={{}} waitingForWifi={{ ids: [tried.id] }} />,
    );
    expect(screen.queryByText('Still trying')).toBeNull();
    expect(screen.queryByText(/won’t go/u)).toBeNull();
  });

  it('offers "Send now" only when wired, with the cost in its own label', async () => {
    const onSendNow = jest.fn();
    await render(
      <QueueScreen
        items={[note]}
        rejections={{}}
        waitingForWifi={{ ids: [note.id], sizeLabel: '1.6 MB', onSendNow }}
      />,
    );
    await fireEvent.press(screen.getByText('Send now on mobile data — uses 1.6 MB'));
    expect(onSendNow).toHaveBeenCalledTimes(1);
  });

  it('without a size, the button still says it uses mobile data', async () => {
    await render(
      <QueueScreen
        items={[note]}
        rejections={{}}
        waitingForWifi={{ ids: [note.id], onSendNow: () => undefined }}
      />,
    );
    expect(screen.getByText('Send now on mobile data')).toBeTruthy();
  });

  it('with nothing held, there is no block and rows read as before', async () => {
    await render(<QueueScreen items={[note]} rejections={{}} waitingForWifi={{ ids: [] }} />);
    expect(screen.queryByText(/waiting for WiFi/u)).toBeNull();
    expect(screen.getByText('Waiting to send')).toBeTruthy();
  });
});
