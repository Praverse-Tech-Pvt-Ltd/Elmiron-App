import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BeatPlanScreen } from './BeatPlanScreen';
import { MileageScreen } from './MileageScreen';
import { NoticeText } from './NoticeText';
import { QueueScreen } from './QueueScreen';
import { TodayScreen } from './TodayScreen';

/**
 * Handover polish, round 2 — the day's screens (Today, the route, the queue, mileage, the live
 * location notice). Each case is a defect the visual QA pass found on the emulator.
 */
const fontSizeOf = (text: string): number | undefined =>
  StyleSheet.flatten(screen.getByText(text).props['style'] as StyleProp<TextStyle>).fontSize;

describe('FE-W191 — the route names the visit the rep is in', () => {
  const stop = {
    id: 'doctor-1',
    doctorName: 'Dr Asha Deshpande',
    clinic: 'Main clinic, Pune',
    state: 'current' as const,
    detail: '15:29',
    visitId: 'visit-1',
  };

  it('a checked-in stop is "In progress", not "Next stop"', async () => {
    await render(<BeatPlanScreen done={0} planned={3} stops={[{ ...stop, inProgress: true }]} />);
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.queryByText('Next stop')).toBeNull();
  });

  it('POSITIVE CONTROL: a stop not yet begun is still "Next stop"', async () => {
    await render(<BeatPlanScreen done={0} planned={3} stops={[stop]} />);
    expect(screen.getByText('Next stop')).toBeTruthy();
  });
});

describe('FE-W191 — Today', () => {
  const props = {
    dayLabel: 'Today',
    startedLabel: null,
    planned: 3,
    done: 1,
    notMet: 0,
    next: {
      doctorName: 'Dr TEST Vikram Rao (fictional)',
      clinic: null,
      clinicPending: false,
      scheduledLabel: null,
      inProgress: true,
    },
    sync: null,
    onOpenQueue: () => undefined,
    onStartNextVisit: () => undefined,
    onAddUnplannedVisit: () => undefined,
  };

  it('keeps the doctor in the pinned action, behind a short verb', async () => {
    await render(<TodayScreen {...props} />);
    expect(screen.getByText('Back to Dr TEST Vikram Rao (fictional)')).toBeTruthy();
  });

  it('draws "What this app records about me" as a row with a line under it, not a second link', async () => {
    const onOpen = jest.fn();
    await render(<TodayScreen {...props} onOpenTransparency={onOpen} />);
    expect(screen.getByText('What is recorded, and what never is.')).toBeTruthy();
    // A quiet button draws its words in the accent ink; the row's title is ordinary body ink.
    const ink = StyleSheet.flatten(
      screen.getByText('What this app records about me').props['style'] as StyleProp<TextStyle>,
    ).color;
    expect(ink).not.toBe(tokens.color.accent);
    expect(
      StyleSheet.flatten(
        screen.getByText('Add an unplanned visit').props['style'] as StyleProp<TextStyle>,
      ).color,
    ).toBe(tokens.color.accent);
    await fireEvent.press(screen.getByText('What this app records about me'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('FE-W191 — the queue', () => {
  it('draws the "sent" tick in the success green, as everywhere else', async () => {
    await render(<QueueScreen items={[]} rejections={{}} />);
    const tick = screen.getByText('✓', { includeHiddenElements: true });
    expect(StyleSheet.flatten(tick.props['style'] as StyleProp<TextStyle>).color).toBe(
      tokens.color.success,
    );
  });

  it('says when everything was last sent, when it is known', async () => {
    await render(<QueueScreen items={[]} lastSentLabel="Last sent at 16:52." rejections={{}} />);
    expect(screen.getByText('Last sent at 16:52.')).toBeTruthy();
  });

  it('FE-W189: the stuck block’s sentences are at the prose step', async () => {
    await render(
      <QueueScreen
        items={[{ id: 'a', entity: 'call_report', status: 'queued', attemptCount: 5 }]}
        rejections={{}}
      />,
    );
    expect(fontSizeOf('This is not counted against you. The upload failed, not you.')).toBe(
      tokens.typography.secondary.size,
    );
  });
});

describe('FE-W189 — mileage sentences are prose, not labels', () => {
  it('sets the straight-line note and the empty detail at Secondary', async () => {
    await render(<MileageScreen days={[]} rateNote="Distance only." totalLabel={null} />);
    expect(
      fontSizeOf(
        'Measured in straight lines between the visits you checked into, so it counts less than the roads you actually rode.',
      ),
    ).toBe(tokens.typography.secondary.size);
    expect(fontSizeOf('Distance appears once you have checked into more than one visit.')).toBe(
      tokens.typography.secondary.size,
    );
  });
});

describe('FE-W191 — a notice laid out as written', () => {
  const blocks = [
    { kind: 'paragraph' as const, text: 'Opening words.' },
    { kind: 'heading' as const, text: 'When your location is shared' },
    { kind: 'bullets' as const, items: ['Only during your working hours.'] },
  ];

  it('gives a section heading air above it, so it belongs to what follows', async () => {
    await render(<NoticeText blocks={blocks} />);
    // The nearest ancestor that sets a top padding.
    let node = screen.getByText('When your location is shared').parent;
    let top: unknown = undefined;
    while (node !== null && top === undefined) {
      top = (
        StyleSheet.flatten(node.props['style'] as StyleProp<ViewStyle>) as ViewStyle | undefined
      )?.paddingTop;
      node = node.parent;
    }
    expect(top).toBe(tokens.space.md);
  });

  it('hangs a bullet: the mark and the words side by side', async () => {
    await render(<NoticeText blocks={blocks} />);
    expect(screen.getByText('•')).toBeTruthy();
    expect(screen.getByText('Only during your working hours.')).toBeTruthy();
  });
});
