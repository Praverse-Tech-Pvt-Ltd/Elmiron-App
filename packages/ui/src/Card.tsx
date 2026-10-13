import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { SurfaceContext } from './surface';
import { elevationStyle } from './depth';

/**
 * Phase 1 §05: 20px radius, shadow rather than an outline, one dark hero per
 * screen.
 *
 * §01 is the reason there is no border here. Separation comes from the paper-to-card
 * step plus a soft shadow; an outline on every card turns a calm screen into a grid
 * of boxes. The only card that carries an edge is `offline`, and that edge is
 * dashed — §02 makes the dash the signal so the colour never has to be.
 *
 * `hero` is a whole-card inversion, not a tint. It publishes `SurfaceContext` so
 * the text inside comes out white without the caller passing a colour, and the
 * "one per screen" rule stays the caller's discipline — a component cannot count
 * its siblings.
 */
/**
 * `quiet` — a note ABOUT the screen rather than content on it: who can see this, where it came
 * from, what the AI may and may not do. Flat on the page ground with a hairline edge. Those notes
 * used to borrow `offline`'s dashed card, which tells the rep something is waiting on this phone.
 */
export type CardTone = 'default' | 'hero' | 'offline' | 'quiet';

export interface CardProps {
  readonly children: ReactNode;
  readonly tone?: CardTone;
  /** Omit for a card that only displays. A card without this is not pressable. */
  readonly onPress?: () => void;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.xs,
    backgroundColor: tokens.color.surface,
    // FE-W101. B1's card shadow, layer for layer: a 1pt contact line and a deep, soft pool pulled
    // in under the card, so a stack of cards reads as paper resting on paper rather than as
    // material elevation. It replaces a single grey `elevation: 2` and a literal shadow colour.
    ...elevationStyle('card'),
  },
  // B1's hero: more room inside (20 × 24), a little more between its lines, and the deeper shadow
  // the design gives the one dark card on the screen.
  hero: {
    backgroundColor: tokens.color.textPrimary,
    paddingVertical: tokens.space.md + tokens.space.xs,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.sm,
    ...elevationStyle('raised'),
  },
  offline: {
    backgroundColor: tokens.color.offlineFill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.color.offlineEdge,
    // A saved-here card is not raised — it is waiting, not arriving.
    shadowOpacity: 0,
    ...elevationStyle('flat'),
  },
  quiet: {
    backgroundColor: tokens.color.background,
    borderWidth: 1,
    borderColor: tokens.color.hairline,
    shadowOpacity: 0,
    ...elevationStyle('flat'),
  },
  pressedDefault: { backgroundColor: tokens.color.wash },
  pressedHero: { backgroundColor: tokens.color.accentPressed },
  pressedOffline: { backgroundColor: tokens.color.washPressed },
});

const FILL = {
  default: null,
  hero: styles.hero,
  offline: styles.offline,
  quiet: styles.quiet,
} as const;
const PRESSED = {
  default: styles.pressedDefault,
  hero: styles.pressedHero,
  offline: styles.pressedOffline,
  quiet: styles.pressedOffline,
} as const;

export const Card = ({ children, tone = 'default', onPress }: CardProps): ReactNode => {
  const body = (
    <SurfaceContext.Provider value={tone === 'hero' ? 'hero' : 'paper'}>
      {children}
    </SurfaceContext.Provider>
  );

  if (onPress === undefined) {
    return <View style={[styles.base, FILL[tone]]}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.base, FILL[tone], pressed ? PRESSED[tone] : null]}
    >
      {body}
    </Pressable>
  );
};
