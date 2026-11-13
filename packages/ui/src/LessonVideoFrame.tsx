import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Secondary } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { useT } from './i18n';

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
 *
 * `FE-W183`. Its words are on the catalogue; the length line and the play label arrive already in
 * the app's language from `lesson-video-view.ts`.
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
  /**
   * `FE-W179`. The play mark is DRAWN — a triangle from three borders, as the tab icons are — and
   * not the character "▶", which iOS can render as a colour emoji when no font claims it and which
   * took an off-scale 22pt size and a 3pt nudge. The triangle points right; a `space.xs` margin
   * moves it right of centre, because a triangle's weight sits toward its base and the eye reads
   * the centred one as left of the circle's middle.
   */
  playMark: {
    width: 0,
    height: 0,
    borderTopWidth: tokens.space.sm + tokens.space.xxs,
    borderBottomWidth: tokens.space.sm + tokens.space.xxs,
    borderLeftWidth: tokens.space.md + tokens.space.xxs,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: tokens.color.onAccent,
    marginLeft: tokens.space.xs,
  },
});

export const LessonVideoFrame = ({ view }: { readonly view: LessonVideoFrameView }): ReactNode => {
  const { t } = useT();
  switch (view.kind) {
    case 'failed':
      return (
        <Card tone="quiet">
          <BodyText>{view.line}</BodyText>
          <Button label={t('common.tryAgain')} onPress={view.onRetry} variant="secondary" />
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
          <Secondary>{view.lengthLabel}</Secondary>
        </View>
      );
    case 'poster':
      return (
        <View style={styles.block}>
          <Pressable
            accessibilityHint={t('learning.videoPlayHint')}
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
                  accessibilityLabel={t('learning.videoStarting')}
                  color={tokens.color.onAccent}
                />
              ) : (
                <View style={styles.playMark} />
              )}
            </View>
          </Pressable>
          <Secondary>{view.lengthLabel}</Secondary>
        </View>
      );
  }
};
