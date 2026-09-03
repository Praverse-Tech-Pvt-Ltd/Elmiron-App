import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { SurfaceContext } from './surface';

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
export type CardTone = 'default' | 'hero' | 'offline';

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
    // Soft and low, so a stack of cards reads as paper rather than as elevation.
    shadowColor: '#14150F',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  hero: { backgroundColor: tokens.color.textPrimary },
  offline: {
    backgroundColor: tokens.color.offlineFill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.color.offlineEdge,
    // A saved-here card is not raised — it is waiting, not arriving.
    shadowOpacity: 0,
    elevation: 0,
  },
  pressedDefault: { backgroundColor: tokens.color.wash },
  pressedHero: { backgroundColor: tokens.color.accentPressed },
  pressedOffline: { backgroundColor: tokens.color.washPressed },
});

const FILL = { default: null, hero: styles.hero, offline: styles.offline } as const;
const PRESSED = {
  default: styles.pressedDefault,
  hero: styles.pressedHero,
  offline: styles.pressedOffline,
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
