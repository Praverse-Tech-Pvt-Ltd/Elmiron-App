import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TopInsetProps {
  readonly children: ReactNode;
}

/**
 * The device's top inset, for the one thing `Screen` cannot reach.
 *
 * `Screen` applies all four insets once, so that a new screen is correct by default. That
 * covers every screen because every screen renders inside it. It does **not** cover anything
 * mounted **above the navigator** — `app/_layout.tsx` renders `ZoneCaveatBanner` there on
 * purpose, so that one banner qualifies all eleven screens that show a date, and that position
 * is exactly what puts it outside `Screen`.
 *
 * With no inset such an element draws **underneath the status bar**. On a Pixel 10 (API 36,
 * where Android enforces edge-to-edge) the clock rendered straight through the banner's title
 * and covered its attention glyph entirely — the same defect `Screen`'s own comment records
 * from FE-Build-2b, reappearing in the one place the fix does not reach.
 *
 * **Top only, and no token padding.** This wraps content that brings its own padding; adding
 * the design's margin here would double it. The left and right insets are omitted because the
 * app is `portrait`-locked in `app.json` and a portrait device reports neither — padding an
 * edge that cannot be non-zero would be guessing at a hardware quantity rather than reading
 * one. The bottom inset belongs to whatever sits at the bottom, which is not this.
 */
export const TopInset = ({ children }: TopInsetProps): ReactNode => {
  const insets = useSafeAreaInsets();

  return <View style={{ paddingTop: insets.top }}>{children}</View>;
};
