import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';

/**
 * Phase 1 §05: "the atom of contestability · every finding has one."
 *
 * A finding without one is an assertion the MR cannot check. This component is
 * what makes a coaching note contestable — the timestamp, the words that were
 * actually said, and how long the audio behind them will exist. All three are
 * required props for that reason; there is no shape of this component that shows a
 * claim without its evidence.
 *
 * `retention` is a sentence, not a date, because "audio kept 61 more days" and
 * "audio deleted at 90 days · transcript kept" are different promises and the
 * second one still supports the quote. The MR is told which they are looking at
 * before they decide whether to argue with it.
 *
 * **Redaction runs upstream.** If a span ever reaches this component containing a
 * patient detail, the pipeline failed, not the UI. What this component guarantees
 * is that a redacted span renders `[removed]` in place of the words rather than
 * dropping the sentence — so the MR can see that something was cut, which is the
 * difference between a redaction and a quiet edit.
 */
export interface CitationSpanProps {
  /** Position in the recording — "02:14". */
  readonly timestamp: string;
  /** What happens to the audio behind this quote, in words. */
  readonly retention: string;
  /** The words. May contain `[removed]` where redaction ran. */
  readonly quote: string;
  /** Progress while playing — "00:09 / 00:24". Present only when `playing`. */
  readonly position?: string;
  readonly playing?: boolean;
  /**
   * Omit when the audio is gone and only the transcript remains. The quote still
   * renders; it simply is not pressable, because there is nothing to play.
   */
  readonly onPlay?: () => void;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radius.well,
    backgroundColor: tokens.color.wash,
    padding: tokens.space.sm,
    gap: tokens.space.xs,
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.accent,
  },
  pressed: { backgroundColor: tokens.color.washPressed },
  playing: { backgroundColor: tokens.color.successFill },
  head: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs },
  meta: { flex: 1 },
});

export const CitationSpan = ({
  timestamp,
  retention,
  quote,
  position,
  playing = false,
  onPlay,
}: CitationSpanProps): ReactNode => {
  const body = (
    <>
      <View style={styles.head}>
        <View style={styles.meta}>
          <Label muted>{`${timestamp} · ${retention}`}</Label>
        </View>
        {playing && position !== undefined ? <Label muted>{position}</Label> : null}
      </View>
      <BodyText>{`“${quote}”`}</BodyText>
    </>
  );

  if (onPlay === undefined) {
    return <View style={styles.base}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={`Play the recording at ${timestamp}`}
      accessibilityRole="button"
      accessibilityState={{ busy: playing }}
      onPress={onPlay}
      style={({ pressed }) => [
        styles.base,
        playing ? styles.playing : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {body}
    </Pressable>
  );
};
