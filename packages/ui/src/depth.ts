import { Platform } from 'react-native';
import type { ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import type { ElevationTokens } from '@fieldforce/ui-tokens';

/**
 * FE-W101. A surface's depth, as a style, from `tokens.elevation`.
 *
 * The design's shadows are layered CSS `box-shadow`s, and React Native's `boxShadow` draws them as
 * written — warm ink, negative spread, two layers — where Android's `elevation` can only draw one
 * grey material shadow whose shape nobody chose. `boxShadow` needs API 28 for an outset shadow,
 * so below that the level's `androidFallback` elevation is used **instead**, never as well: both
 * at once is a card with two shadows.
 *
 * Every surface reaches depth through this, so no component carries a shadow literal and a
 * change to how the product sits on the page is one file (`tokens.ts`).
 */
export type ElevationName = keyof ElevationTokens;

const boxShadowSupported = (): boolean =>
  Platform.OS !== 'android' || (typeof Platform.Version === 'number' && Platform.Version >= 28);

export const elevationStyle = (name: ElevationName): ViewStyle => {
  const level = tokens.elevation[name];
  if (!boxShadowSupported()) {
    return { elevation: level.androidFallback };
  }
  // `elevation: 0` alongside, so a level of `flat` also clears a fallback a style below set.
  return { boxShadow: level.layers.map((layer) => ({ ...layer })), elevation: 0 };
};
