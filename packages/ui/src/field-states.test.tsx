import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { ListItem } from './ListItem';
import { RecordingIndicator } from './RecordingIndicator';
import type { RecordingState } from './RecordingIndicator';
import { Select } from './Select';
import { SyncQueueIndicator } from './SyncQueueIndicator';
import type { SyncQueueState } from './SyncQueueIndicator';
import { Toast } from './Toast';

const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

/**
 * The height actually in force on the row containing `text`, found by walking up
 * from the text rather than by assuming which ancestor carries it. Asserting on a
 * fixed `.parent.parent` breaks on any wrapper change and says nothing about the
 * number that reaches the screen.
 */
const rowHeightAround = (text: string): unknown => {
  let node = screen.getByText(text).parent;
  while (node !== null) {
    const style = flatten(node.props['style']);
    if (typeof style['minHeight'] === 'number') return style['minHeight'];
    node = node.parent;
  }
  throw new Error(`no ancestor of "${text}" carries a minHeight`);
};

/**
 * The one rule this file exists to defend: **a normal state never renders as a
 * failure.**
 *
 * §02 and §05 say it four different ways — offline is the expected condition for
 * most of an MR's day, "waiting" is never red, a declined consent is not an error,
 * an empty list is not an error. It is the easiest rule in the design to break by
 * accident, because `critical` is right there and every one of these states is
 * *slightly* unhappy. So the assertions below are mostly negative: they check that
 * the critical colour is absent, which is the thing that goes wrong.
 */
describe('offline and waiting are never styled as failures', () => {
  const neverCritical = (style: Record<string, unknown>): void => {
    expect(style['backgroundColor']).not.toBe(tokens.color.criticalFill);
    expect(style['borderColor']).not.toBe(tokens.color.critical);
    expect(style['borderLeftColor']).not.toBe(tokens.color.critical);
  };

  it('gives an offline banner no warning colour anywhere', async () => {
    await render(
      <Banner
        detail="Check-ins, reports and voice notes save on the phone."
        title="No signal — everything still works"
        tone="offline"
      />,
    );
    neverCritical(flatten(screen.getByRole('alert').props['style']));
  });

  it('leaves a waiting queue in the offline tone, not the critical one', async () => {
    const waiting: SyncQueueState = { kind: 'waiting', count: 5 };
    await render(<SyncQueueIndicator onPress={() => undefined} state={waiting} />);
    neverCritical(flatten(screen.getByRole('button').props['style']));
  });

  it('does the same for items held back for WiFi', async () => {
    const wifi: SyncQueueState = { kind: 'wifi', count: 3 };
    await render(<SyncQueueIndicator onPress={() => undefined} state={wifi} />);
    neverCritical(flatten(screen.getByRole('button').props['style']));
  });

  it('but does mark a real send failure as critical — the positive control', async () => {
    // Without this, every assertion above would pass on a component that had no
    // critical styling at all.
    const failed: SyncQueueState = { kind: 'failed', count: 1, attempts: 5 };
    await render(<SyncQueueIndicator onPress={() => undefined} state={failed} />);
    expect(flatten(screen.getByRole('button').props['style'])['backgroundColor']).toBe(
      tokens.color.criticalFill,
    );
  });
});

describe('the sync queue is countable and tappable', () => {
  it('puts the number in the words, not in a dot', async () => {
    const waiting: SyncQueueState = { kind: 'waiting', count: 5 };
    await render(<SyncQueueIndicator onPress={() => undefined} state={waiting} />);
    expect(screen.getByText('5 waiting · no signal')).toBeTruthy();
  });

  it('opens the list when pressed', async () => {
    const onPress = jest.fn();
    await render(<SyncQueueIndicator onPress={onPress} state={{ kind: 'idle', at: '11:42' }} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('the recording indicator always says the word', () => {
  // §05: "The word 'Recording' is always present — the dot alone would fail the
  // colour-alone rule and fail anyone glancing from a distance." Every state, not
  // just the obvious one.
  const states: readonly (readonly [RecordingState, string])[] = [
    ['armed', 'Ready to record'],
    ['recording', 'Recording this visit'],
    ['paused', 'Paused'],
    ['saving', 'Saving to this phone'],
  ];

  it.each(states)('renders words in the %s state', async (state, words) => {
    await render(<RecordingIndicator elapsed="02:41" state={state} />);
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('names the visit while recording', async () => {
    await render(<RecordingIndicator elapsed="02:41" state="recording" />);
    expect(screen.getByText('Recording this visit')).toBeTruthy();
    expect(screen.getByText('02:41')).toBeTruthy();
  });

  it('says why it paused', async () => {
    await render(<RecordingIndicator elapsed="02:41" reason="a call came in" state="paused" />);
    expect(screen.getByText('Paused — a call came in')).toBeTruthy();
  });
});

describe('a list row carries its state in words as well as in colour', () => {
  it('renders the detail line beside the glyph', async () => {
    await render(
      <ListItem
        detail="09:20 · consented · synced"
        meta="09:20"
        status="success"
        title="Dr. A. Menon"
      />,
    );
    expect(screen.getByText('09:20 · consented · synced')).toBeTruthy();
  });

  it('stands at the §05 row height', async () => {
    await render(
      <ListItem
        detail="Not in the beat plan for today"
        disabled
        status="offline"
        title="Dr. P. Nair"
      />,
    );
    expect(rowHeightAround('Dr. P. Nair')).toBe(tokens.target.row);
    expect(tokens.target.row).toBe(70);
  });
});

describe('a select opens a sheet, never a dropdown', () => {
  it('keeps the label visible whether or not anything is chosen', async () => {
    await render(
      <Select
        label="Visit outcome"
        onChange={() => undefined}
        options={[{ value: 'detailed', label: 'Detailed, samples left' }]}
      />,
    );
    // The label is a sibling of the control, so it survives a value being set —
    // which is the whole objection to placeholder-only labels.
    expect(screen.getByText('Visit outcome')).toBeTruthy();
    expect(screen.getByText('Choose one')).toBeTruthy();
  });

  it('shows the options only after the control is pressed', async () => {
    const onChange = jest.fn();
    await render(
      <Select
        label="Visit outcome"
        onChange={onChange}
        options={[{ value: 'detailed', label: 'Detailed, samples left' }]}
      />,
    );
    expect(screen.queryByText('Detailed, samples left')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Visit outcome'));
    await fireEvent.press(screen.getByText('Detailed, samples left'));
    expect(onChange).toHaveBeenCalledWith('detailed');
  });
});

describe('a toast does not block and does not linger', () => {
  it('dismisses itself after the §05 five seconds', async () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    try {
      await render(
        <Toast message="Checked in at Sunrise Clinic" onDismiss={onDismiss} status="success" />,
      );
      expect(onDismiss).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('offers at most one action, and fires it', async () => {
    const onPress = jest.fn();
    await render(
      <Toast
        action={{ label: 'Undo', onPress }}
        message="Checked in at Sunrise Clinic"
        onDismiss={() => undefined}
        status="success"
      />,
    );
    await fireEvent.press(screen.getByText('Undo'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
