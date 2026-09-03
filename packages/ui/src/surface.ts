import { createContext, useContext } from 'react';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * Which ground the text is sitting on.
 *
 * Phase 1 allows exactly one dark hero card per screen, and text inside it is
 * white. Without something like this, the caller has to remember to pass a colour
 * every time it puts a heading inside a hero — and the failure mode of forgetting
 * is ink on ink, which is invisible rather than merely wrong.
 *
 * So the surface announces itself and the text components read it. A `Heading`
 * placed anywhere gets the right colour with no prop, which is the only version of
 * this rule that survives contact with a screen written in a hurry.
 *
 * `hero` and `accent` resolve to the same ink today and are still separate values:
 * they are different grounds, and a future change to one must not silently change
 * the other.
 */
export type Surface =
  /** Paper or a white card. Ink text, muted for supporting copy. */
  | 'paper'
  /** The dark hero card. */
  | 'hero'
  /** An accent fill — a selected chip, a primary button's ground. */
  | 'accent';

export const SurfaceContext = createContext<Surface>('paper');

/** The ink for the current surface. `muted` picks the secondary tone. */
export const useSurfaceInk = (muted: boolean): string => {
  const surface = useContext(SurfaceContext);
  if (surface === 'hero' || surface === 'accent') {
    // §01 puts white on the ink hero at 16.25:1. There is no second tone on a hero
    // — a muted white is a grey on near-black, and Phase 1 bans a third grey — so
    // muted copy keeps the same white and steps down by size and weight instead.
    return tokens.color.onAccent;
  }
  return muted ? tokens.color.textSecondary : tokens.color.textPrimary;
};
