import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { StatusGlyph } from './StatusGlyph';
import { useT } from './i18n';
import type { TextKey } from './i18n';

/**
 * Phase 1 §05, and Apple's 2.5.14 by name: while audio is being captured, the fact
 * is on screen persistently and reaches into the status bar.
 *
 * **The word is always present.** A dot alone fails §02's colour-alone rule and
 * fails anyone reading the phone from across a desk — which is precisely who this
 * component is for. The doctor is the second audience, and they are the reason the
 * mark is terracotta rather than signal red: consented recording is a normal thing
 * happening, not a fault condition.
 *
 * `armed` exists so the MR can see the app is ready *before* anything is captured.
 * It says "Ready to record" and shows a hollow mark, because a filled dot that
 * means "not yet recording" is the one ambiguity this component cannot afford.
 */
export type RecordingState = 'armed' | 'recording' | 'paused' | 'saving';

export interface RecordingIndicatorProps {
  readonly state: RecordingState;
  /** Elapsed time, mm:ss. Absent while armed. */
  readonly elapsed?: string;
  /** Why it paused — "a call came in". Shown with `paused`. */
  readonly reason?: string;
}

/** `FE-W150`. Keys, read at render, so the bar follows a language change. */
const WORDS: Record<RecordingState, TextKey> = {
  armed: 'visit.recordingArmed',
  recording: 'visit.recordingActive',
  paused: 'visit.recordingPaused',
  saving: 'visit.recordingSaving',
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.control,
    minHeight: tokens.target.secondary,
    // `FE-W181`. The recording tint, from the palette; it was the app's one literal colour.
    backgroundColor: tokens.color.recordingFill,
  },
  armed: { backgroundColor: tokens.color.wash },
  words: { flex: 1 },
  hollow: {
    width: 11,
    height: 11,
    borderRadius: tokens.radius.pill,
    borderWidth: 1.8,
    borderColor: tokens.color.recording,
  },
});

export const RecordingIndicator = ({
  state,
  elapsed,
  reason,
}: RecordingIndicatorProps): ReactNode => {
  const { t } = useT();
  const words =
    state === 'paused' && reason !== undefined
      ? t('visit.recordingPausedBecause', { reason })
      : t(WORDS[state]);

  return (
    <View
      accessibilityLabel={
        elapsed === undefined ? words : t('visit.recordingWithElapsed', { state: words, elapsed })
      }
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessible
      style={[styles.base, state === 'armed' ? styles.armed : null]}
    >
      {state === 'armed' ? <View style={styles.hollow} /> : <StatusGlyph kind="recording" />}
      <View style={styles.words}>
        <BodyText>{words}</BodyText>
      </View>
      {elapsed === undefined ? null : <Label muted>{elapsed}</Label>}
    </View>
  );
};
