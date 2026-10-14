import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import { tokens } from '@fieldforce/ui-tokens';
import { AnalysisReplyScreen } from './AnalysisReplyScreen';
import { AnalysisScreen } from './AnalysisScreen';
import { Banner } from './Banner';
import { BottomSheet } from './BottomSheet';
import { CoachingFeedScreen } from './CoachingFeedScreen';
import { DayEndScreen } from './DayEndScreen';
import { DoctorListScreen } from './DoctorListScreen';
import { Select } from './Select';
import { SetupStepList } from './SetupStepList';
import { StatusGlyph } from './StatusGlyph';
import { SurfaceContext } from './surface';
import { TabBarLabel } from './TabIcon';
import {
  BodyText,
  Display,
  Figure,
  Heading,
  Label,
  MAX_FONT_SCALE,
  Secondary,
  Statement,
  TapLabel,
  Title,
} from './Text';
import { Toast } from './Toast';
import { VoiceNoteScreen } from './VoiceNoteScreen';

/**
 * The handover polish pass (`FE-W176`–`FE-W184`), asserted on what reaches the screen: the colour
 * and size a piece of text is drawn at, not the component that drew it.
 */
const noop = (): void => undefined;

const styleOf = (text: string): Record<string, unknown> =>
  StyleSheet.flatten(screen.getByText(text).props['style']) as Record<string, unknown>;

const inHero = (node: ReactElement): ReactElement => (
  <SurfaceContext.Provider value="hero">{node}</SurfaceContext.Provider>
);

/**
 * `FE-W176`. Inside the dark hero every role is white — that is what `SurfaceContext` is for. A
 * light ground placed inside the hero has to say so again, or its words come out white on white.
 * The voice note's microphone banner did exactly that on every first open: white on `attentionFill`.
 */
describe('FE-W176 — a light ground inside a hero keeps its own ink', () => {
  it('draws a banner’s title and detail in ink inside the hero, while the hero’s own text stays white', async () => {
    await render(
      inHero(
        <>
          <BodyText>The hero’s own line</BodyText>
          <Banner
            detail="Tap Allow when the phone asks."
            title="Allow the microphone"
            tone="attention"
          />
        </>,
      ),
    );
    // Positive control: the hero still turns its own text white.
    expect(styleOf('The hero’s own line')['color']).toBe(tokens.color.onAccent);
    expect(styleOf('Allow the microphone')['color']).toBe(tokens.color.textPrimary);
    expect(styleOf('Tap Allow when the phone asks.')['color']).toBe(tokens.color.textSecondary);
  });

  it('the voice note’s “waiting for the microphone” banner is readable on first open', async () => {
    await render(
      <VoiceNoteScreen
        blocked="Waiting for you to allow the microphone."
        elapsed="00:00"
        hint="Try covering what they asked."
        onHoldEnd={noop}
        onHoldStart={noop}
        onStartAgain={noop}
        prompt="What should I put in the report?"
        recording={false}
        subject="Your note"
      />,
    );
    expect(styleOf('No note can be recorded yet')['color']).toBe(tokens.color.textPrimary);
    expect(styleOf('Waiting for you to allow the microphone.')['color']).toBe(
      tokens.color.textSecondary,
    );
    // The recorder's own words, on the dark card, are still white.
    expect(styleOf('Your note')['color']).toBe(tokens.color.onAccent);
  });

  it('a Select inside a hero: its label on the hero is white, its value on the white field is ink', async () => {
    await render(
      inHero(
        <Select
          label="Product"
          onChange={noop}
          options={[{ value: 'a', label: 'Elmiron 100 mg' }]}
          value="a"
        />,
      ),
    );
    expect(styleOf('Product')['color']).toBe(tokens.color.onAccent);
    expect(styleOf('Elmiron 100 mg')['color']).toBe(tokens.color.textPrimary);
  });

  it('a bottom sheet opened from inside a hero is ink on white', async () => {
    await render(
      inHero(
        <BottomSheet onDismiss={noop} title="Choose a product" visible>
          <BodyText>Elmiron 100 mg</BodyText>
        </BottomSheet>,
      ),
    );
    expect(styleOf('Choose a product')['color']).toBe(tokens.color.textPrimary);
    expect(styleOf('Elmiron 100 mg')['color']).toBe(tokens.color.textPrimary);
  });
});

/** `FE-W177`. Phase 1: "any tappable label below 14px" is banned. `label` is 13.5. */
describe('FE-W177 — no tappable label below 14', () => {
  const atLeast14 = (text: string): void => {
    expect(styleOf(text)['fontSize'] as number).toBeGreaterThanOrEqual(14);
  };

  it('the tab bar’s label, capped in how far it grows', async () => {
    await render(<TabBarLabel color={tokens.color.accent}>Doctors</TabBarLabel>);
    atLeast14('Doctors');
    expect(screen.getByText('Doctors').props['maxFontSizeMultiplier']).toBe(MAX_FONT_SCALE);
  });

  it('the doctor list’s filter chips, on and off', async () => {
    await render(
      <DoctorListScreen
        activeFilter="all"
        filters={[
          { id: 'all', label: 'All' },
          { id: 'overdue', label: 'Overdue' },
        ]}
        onQueryChange={noop}
        query=""
        rows={[]}
      />,
    );
    atLeast14('All');
    atLeast14('Overdue');
    // The selected chip is on the accent fill, so its label is white.
    expect(styleOf('All')['color']).toBe(tokens.color.onAccent);
  });

  it('"Mark done" and a vendor shortcut on the battery steps', async () => {
    await render(
      <SetupStepList
        onToggleDone={noop}
        steps={[
          {
            id: 's1',
            title: 'Allow background activity',
            done: false,
            shortcut: { label: 'Open battery settings', onPress: noop },
          },
        ]}
      />,
    );
    atLeast14('Mark done');
    atLeast14('Open battery settings');
  });

  it('a toast’s action', async () => {
    await render(
      <Toast
        action={{ label: 'Undo', onPress: noop }}
        message="Saved on this phone."
        onDismiss={noop}
        status="success"
      />,
    );
    atLeast14('Undo');
  });

  it('TapLabel, the role for it', async () => {
    await render(<TapLabel>Near me</TapLabel>);
    expect(styleOf('Near me')['fontSize']).toBe(tokens.typography.tappable.size);
  });
});

/** `FE-W178`. A sentence is set at the prose step, never at `Label`'s 13.5. */
describe('FE-W178 — sentences at the prose step', () => {
  it('a banner’s detail', async () => {
    await render(
      <Banner detail="It will send by itself." title="Saved on this phone" tone="info" />,
    );
    expect(styleOf('It will send by itself.')['fontSize']).toBe(tokens.typography.secondary.size);
  });
});

/** `FE-W179`. Text wraps inside a row; text in a fixed size is capped in how far it grows. */
describe('FE-W179 — text wraps in rows, and fixed sizes stay fixed', () => {
  it('every text role can shrink, so it wraps beside a glyph or a time instead of running off', async () => {
    await render(
      <>
        <Figure>Figure</Figure>
        <Display>Display</Display>
        <Title>Title</Title>
        <Heading>Heading</Heading>
        <Statement>Statement</Statement>
        <BodyText>Body</BodyText>
        <Secondary>Secondary</Secondary>
        <Label>Label</Label>
        <TapLabel>Tappable</TapLabel>
      </>,
    );
    for (const text of [
      'Figure',
      'Display',
      'Title',
      'Heading',
      'Statement',
      'Body',
      'Secondary',
      'Label',
      'Tappable',
    ]) {
      expect(styleOf(text)['flexShrink']).toBe(1);
    }
  });

  it('caps the figure and the display line, and never ordinary text', async () => {
    await render(
      <>
        <Figure>₹412</Figure>
        <Display>That’s Dr. Iyer done</Display>
        <BodyText>Six of nine visits done.</BodyText>
      </>,
    );
    expect(screen.getByText('₹412').props['maxFontSizeMultiplier']).toBe(MAX_FONT_SCALE);
    expect(screen.getByText('That’s Dr. Iyer done').props['maxFontSizeMultiplier']).toBe(
      MAX_FONT_SCALE,
    );
    expect(screen.getByText('Six of nine visits done.').props['maxFontSizeMultiplier']).toBe(
      undefined,
    );
    expect(MAX_FONT_SCALE).toBeGreaterThan(1);
  });

  it('centres a glyph on the first line of the words beside it, scaled as the words are', async () => {
    await render(<StatusGlyph kind="success" lineHeight={tokens.typography.body.lineHeight} />);
    // Hidden from a screen reader on purpose (the words beside it carry the meaning), so asked for
    // with hidden elements included.
    const mark = screen.getByText('✓', { includeHiddenElements: true });
    const line = StyleSheet.flatten(mark.parent?.props['style']) as Record<string, unknown>;
    expect(line['height']).toBe(
      tokens.typography.body.lineHeight * Dimensions.get('window').fontScale,
    );
    expect(line['justifyContent']).toBe('center');
    expect(mark.props['maxFontSizeMultiplier']).toBe(MAX_FONT_SCALE);
  });
});

/** `FE-W180`. The sheet's last row and footer sit above the gesture bar, not under it. */
describe('FE-W180 — the bottom sheet clears the gesture bar', () => {
  const METRICS: Metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  };

  it('adds the bottom inset to the sheet’s own padding', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <BottomSheet onDismiss={noop} title="Choose one" visible>
          <BodyText>A row</BodyText>
        </BottomSheet>
      </SafeAreaProvider>,
    );
    let node = screen.getByText('Choose one').parent;
    let padding: unknown;
    while (node !== null && padding === undefined) {
      padding = (StyleSheet.flatten(node.props['style']) as Record<string, unknown> | undefined)?.[
        'paddingBottom'
      ];
      // The header's own padding is not the sheet's: keep walking past it.
      if (padding === tokens.space.sm) padding = undefined;
      node = node.parent;
    }
    expect(padding).toBe(tokens.space.lg + 34);
  });
});

/**
 * `FE-W180`. A screen's actions are PINNED in `Screen`'s footer, outside the scroll view. These
 * three sat after a `flex: 1` spacer, which `Screen` itself says does nothing inside a ScrollView.
 */
describe('FE-W180 — the actions are pinned, not scrolled to', () => {
  /** True when no ancestor of the text is a scroll view's content. */
  const pinned = (text: string): boolean => {
    let node = screen.getByText(text).parent;
    while (node !== null) {
      if (node.props['contentContainerStyle'] !== undefined) return false;
      node = node.parent;
    }
    return true;
  };

  it('Day end: "End my day" and "See everything", with the day itself still scrolling', async () => {
    await render(
      <DayEndScreen
        captureNote="This app only reads your position when you press check in or check out."
        dayLabel="Today"
        distanceLabel="48.2 km"
        done={9}
        firstCaptureLabel={null}
        lastCaptureLabel={null}
        notMet={0}
        onOpenQueue={noop}
        onOpenTransparency={noop}
        planned={9}
        rateNote="Distance only."
        sync={{ kind: 'idle', at: null }}
        workDay={{
          title: 'Your day is open — started 08:55',
          detail: null,
          tone: 'plain',
          note: { value: '', onChange: noop },
          action: { label: 'End my day', onPress: noop, busy: false, blockedBy: null },
        }}
      />,
    );
    expect(pinned('End my day')).toBe(true);
    expect(pinned('See everything recorded today')).toBe(true);
    // Positive control: the content is in the scroll view.
    expect(pinned('Nothing is being recorded.')).toBe(false);
  });

  it('an analysis: "Add your reply"', async () => {
    await render(
      <AnalysisScreen
        audioNote="This build cannot play audio back."
        consentLabel={null}
        doctorName="Dr S. Iyer"
        findings={[
          {
            id: 'f1',
            workedWell: false,
            summary: 'Cost was not answered.',
            // A finding always carries its evidence (D2): the type requires at least one.
            citations: [
              { timestamp: '02:14', retention: 'audio kept 61 more days', quote: '…cost.' },
            ],
          },
        ]}
        onReply={noop}
        provenanceNote="Written by the system from the transcript."
        whenLabel="14 Aug"
      />,
    );
    expect(pinned('Add your reply')).toBe(true);
    expect(pinned('Cost was not answered.')).toBe(false);
  });

  it('a reply: "Send reply"', async () => {
    await render(
      <AnalysisReplyScreen
        finding="Cost was not answered."
        onChangeText={noop}
        onSaveDraft={noop}
        onSend={noop}
        replyNote="Your manager sees this next to the finding."
        value="I did answer it."
        voiceNote="This build cannot record audio."
      />,
    );
    expect(pinned('Send reply')).toBe(true);
    expect(pinned('Cost was not answered.')).toBe(false);
  });
});

/** `FE-W184`. The P2 details: a chart that fits its labels, centred lines. */
describe('FE-W184 — the small layout details', () => {
  it('the coaching chart is at least as tall as its tallest bar and a month label', async () => {
    await render(
      <CoachingFeedScreen
        onOpen={noop}
        onReply={noop}
        periodLabel="Your coaching"
        reviewedNote="3 visits reviewed of 42"
        rows={[]}
        seenFirstNote="You see it first."
        trend={{
          caption: 'Objections you answered',
          points: [
            { label: 'Jul', count: 3 },
            { label: 'Aug', count: 4 },
          ],
          note: 'Yours only.',
        }}
      />,
    );
    let node = screen.getByText('Aug').parent;
    let minHeight: unknown;
    while (node !== null && minHeight === undefined) {
      minHeight = (
        StyleSheet.flatten(node.props['style']) as Record<string, unknown> | undefined
      )?.['minHeight'];
      node = node.parent;
    }
    // 44 for the tallest bar, the gap, and the label's own line — it was a fixed 64.
    expect(minHeight).toBe(44 + tokens.space.xs + tokens.typography.label.lineHeight);
  });

  it('centres the voice note’s status line by line', async () => {
    await render(
      <VoiceNoteScreen
        elapsed="00:00"
        hint="Try covering what they asked."
        onHoldEnd={noop}
        onHoldStart={noop}
        onStartAgain={noop}
        prompt="What should I put in the report?"
        recording={false}
        subject="Your note"
      />,
    );
    expect(styleOf('Hold the button below to start')['textAlign']).toBe('center');
  });
});
