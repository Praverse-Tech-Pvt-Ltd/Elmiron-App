import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { listItemStyle } from './ListItem';
import type { StatusKind } from './StatusGlyph';
import { syncQueueStyle } from './SyncQueueIndicator';
import { holdStyle, VoiceNoteScreen } from './VoiceNoteScreen';
import { handBackMuted } from './ConsentScreen';

/**
 * FE-D7 2 — every tappable element on the demo path shows its press, with the design's values.
 *
 * The designs put a pressed state on every control (`style-active` in `docs/design/`). Asserted
 * through each component's own style function, as `Button.test.tsx` does and for its reason: React
 * Native drives `pressed` through the responder system, and a fired press event does not flip it.
 *
 * Two kinds of assertion. **The value**: the design's pressed fill, through a token. **That it is
 * visible at all**: pressed differs from unpressed. The second is the one that was failing — the
 * offline row pressed to `wash`, which IS `offlineFill`, so a press on it changed nothing.
 */
const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

const fill = (style: unknown): unknown => flatten(style)['backgroundColor'];

const STATUSES: readonly StatusKind[] = [
  'success',
  'attention',
  'critical',
  'info',
  'offline',
  'recording',
  'neutral',
];

describe('ListItem — the rows of the beat plan, the queue and the doctor list', () => {
  it('a plain row presses to the wash', () => {
    expect(fill(listItemStyle('success', { pressed: true }))).toBe(tokens.color.wash);
  });

  it('an offline row presses to the pressed wash, as the design draws #F1EFE8 → #E5E2D9', () => {
    expect(fill(listItemStyle('offline', { pressed: true }))).toBe(tokens.color.washPressed);
  });

  it('a selected row presses to the pressed success tint, #E9F0E9 → #DDE7DC', () => {
    expect(fill(listItemStyle('success', { pressed: true, selected: true }))).toBe(
      tokens.color.successFillPressed,
    );
  });

  it('changes when pressed, whatever the row is showing', () => {
    const unchanged = STATUSES.flatMap((status) =>
      [false, true]
        .filter(
          (selected) =>
            fill(listItemStyle(status, { pressed: true, selected })) ===
            fill(listItemStyle(status, { pressed: false, selected })),
        )
        .map((selected) => `${status}${selected ? ', selected' : ''}`),
    );
    expect(unchanged).toEqual([]);
  });
});

describe('SyncQueueIndicator — the queue chip on Home', () => {
  it('an offline chip presses to the pressed wash', () => {
    expect(fill(syncQueueStyle('offline', true))).toBe(tokens.color.washPressed);
  });

  it('changes when pressed, whatever it is showing', () => {
    const unchanged = STATUSES.filter(
      (status) => fill(syncQueueStyle(status, true)) === fill(syncQueueStyle(status, false)),
    );
    expect(unchanged).toEqual([]);
  });
});

describe('VoiceNoteScreen — the hold-to-record button (D7)', () => {
  it('is the design sage, and darkens to the pressed sage while held', () => {
    expect(fill(holdStyle(false))).toBe(tokens.color.sage);
    expect(fill(holdStyle(true))).toBe(tokens.color.sagePressed);
  });

  it('never fades or scales', () => {
    const held = flatten(holdStyle(true));
    expect(held['opacity']).toBeUndefined();
    expect(held['transform']).toBeUndefined();
  });

  it('labels the button in ink, which is readable on the sage, not white', async () => {
    await render(
      <VoiceNoteScreen
        elapsed="0:00"
        hint="Try covering what he asked."
        onHoldEnd={() => undefined}
        onHoldStart={() => undefined}
        onStartAgain={() => undefined}
        prompt="What should I put in the report?"
        recording={false}
        subject="Your note"
      />,
    );
    expect(flatten(screen.getByText('Hold to record').props['style'])['color']).toBe(
      tokens.color.textPrimary,
    );
  });
});

describe('ConsentScreen — "Give the phone back"', () => {
  // `muted` on paper is `textSecondary`; unmuted is ink. The design: color #585B52 → #1F211C.
  it('darkens its words to ink when pressed, instead of fading', () => {
    expect(handBackMuted(false)).toBe(true);
    expect(handBackMuted(true)).toBe(false);
  });
});
