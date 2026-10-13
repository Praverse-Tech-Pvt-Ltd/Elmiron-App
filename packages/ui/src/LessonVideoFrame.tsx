import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';

/**
 * `FE-W127` — the frame a lesson's video sits in, above the lesson's text. The PLAYER is the app's
 * (`expo-video`, `apps/field/src/learning/lesson-video.tsx`), handed in as `renderPlayer`, so the design
 * system takes no media dependency; everything the rep sees around it is drawn here, from the tokens.
 *
 * - `poster`: the poster (or a plain ink frame) with one play mark — the whole frame is the button.
 *   While the clip's link is being fetched the mark shows a spinner and the frame is busy.
 * - `playing`: the app's player, filling the same 16:9 frame.
 * - `failed`: one neutral line on a quiet card — no signal is not an alarm — and "Try again" as a
 *   SECONDARY button, so the lesson keeps one primary action.
 *
 * Nothing here animates by itself, so "Remove animations" has nothing to suppress.
 */
export type LessonVideoFrameView =
  | {
      readonly kind: 'poster';
      readonly posterUri: string | null;
      /** True while the clip's link is being fetched. */
      readonly starting: boolean;
      readonly lengthLabel: string;
      /** What a screen reader hears on the frame. */
      readonly playLabel: string;
      readonly onPlay: () => void;
    }
  | {
      readonly kind: 'playing';
      readonly lengthLabel: string;
      readonly renderPlayer: (fill: StyleProp<ViewStyle>) => ReactNode;
    }
  | { readonly kind: 'failed'; readonly line: string; readonly onRetry: () => void };

const styles = StyleSheet.create({
  block: { gap: tokens.space.xs },
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: tokens.radius.well,
    overflow: 'hidden',
    backgroundColor: tokens.color.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  play: {
    width: tokens.target.primary,
    height: tokens.target.primary,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: tokens.color.onAccent, fontSize: 22, marginLeft: 3 },
});

export const LessonVideoFrame = ({ view }: { readonly view: LessonVideoFrameView }): ReactNode => {
  switch (view.kind) {
    case 'failed':
      return (
        <Card tone="quiet">
          <BodyText>{view.line}</BodyText>
          <Button label="Try again" onPress={view.onRetry} variant="secondary" />
        </Card>
      );
    case 'playing':
      return (
        <View style={styles.block}>
          <View
            accessibilityLabel={view.lengthLabel}
            style={styles.frame}
            testID="lesson-video-player"
          >
            {view.renderPlayer(styles.fill)}
          </View>
          <Label muted>{view.lengthLabel}</Label>
        </View>
      );
    case 'poster':
      return (
        <View style={styles.block}>
          <Pressable
            accessibilityHint="Plays here, in the lesson. It needs a connection."
            accessibilityLabel={view.playLabel}
            accessibilityRole="button"
            accessibilityState={{ busy: view.starting }}
            disabled={view.starting}
            onPress={view.onPlay}
            style={styles.frame}
          >
            {view.posterUri === null ? null : (
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                source={{ uri: view.posterUri }}
                style={styles.fill}
              />
            )}
            <View style={styles.play}>
              {view.starting ? (
                <ActivityIndicator
                  accessibilityLabel="Starting the video"
                  color={tokens.color.onAccent}
                />
              ) : (
                <Text style={styles.glyph}>▶</Text>
              )}
            </View>
          </Pressable>
          <Label muted>{view.lengthLabel}</Label>
        </View>
      );
  }
};
