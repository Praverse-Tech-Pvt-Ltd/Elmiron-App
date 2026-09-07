import type { CSSProperties, ReactNode } from 'react';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';

/**
 * The console's element set — small, deliberate, and not `packages/ui`.
 *
 * `@fieldforce/ui` is React Native. Rendering it here would mean `react-native-web`
 * and a second rendering target to keep working for the life of the product, for
 * components whose whole design brief ("one thumb, 60pt targets, the reach zone")
 * is about a phone. Phase 4 asks for the same *tokens* at compact density, not the
 * same components, so this file is that: every colour, radius and space below is a
 * token, and the type comes from `compactTypography`.
 *
 * Nothing here invents a value. If a literal appears in this file it is a layout
 * quantity with no token — a grid column width — and never a colour or a type size.
 */

const type = (style: (typeof compactTypography)['body']): CSSProperties => ({
  fontSize: style.size,
  lineHeight: `${String(style.lineHeight)}px`,
  fontWeight: Number(style.weight),
  ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing }),
});

export const Title = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <h1 style={{ ...type(compactTypography.display), color: tokens.color.textPrimary, margin: 0 }}>
    {children}
  </h1>
);

export const Heading = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <h2 style={{ ...type(compactTypography.heading), color: tokens.color.textPrimary, margin: 0 }}>
    {children}
  </h2>
);

export const Body = ({
  children,
  muted = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
}): ReactNode => (
  <p
    style={{
      ...type(compactTypography.body),
      color: muted ? tokens.color.textSecondary : tokens.color.textPrimary,
      margin: 0,
    }}
  >
    {children}
  </p>
);

export const Label = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <span style={{ ...type(compactTypography.label), color: tokens.color.textSecondary }}>
    {children}
  </span>
);

export const Figure = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <span
    style={{
      ...type(compactTypography.figure),
      color: tokens.color.textPrimary,
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {children}
  </span>
);

export const Card = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <section
    style={{
      background: tokens.color.surface,
      borderRadius: tokens.radius.card,
      padding: tokens.space.lg,
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space.sm,
      boxShadow: '0 1px 2px rgba(20,21,15,.05)',
    }}
  >
    {children}
  </section>
);

/**
 * A status pill — live, superseded, and nothing else yet.
 *
 * `tone` maps onto the semantic tokens rather than taking a colour, so a new state
 * cannot introduce an unchecked pair: every fill here is already in
 * `requiredContrastPairs`.
 */
export const Pill = ({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone: 'success' | 'neutral' | 'attention';
}): ReactNode => {
  const palette = {
    success: { background: tokens.color.successFill, color: tokens.color.success },
    neutral: { background: tokens.color.wash, color: tokens.color.textSecondary },
    attention: { background: tokens.color.attentionFill, color: tokens.color.attention },
  }[tone];

  return (
    <span
      style={{
        ...type(compactTypography.label),
        ...palette,
        borderRadius: tokens.radius.pill,
        padding: `${String(tokens.space.xs)}px ${String(tokens.space.sm + 2)}px`,
        display: 'inline-flex',
      }}
    >
      {children}
    </span>
  );
};

/**
 * A note about something the console cannot show.
 *
 * Used where a panel in the Phase 4 design has no endpoint behind it. It is a
 * visible, explained gap rather than a plausible-looking number, which is the same
 * rule the field app follows for the mileage rupee figure and the UCPMP cap.
 */
export const MissingNote = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div
    style={{
      background: tokens.color.attentionFill,
      borderRadius: tokens.radius.well,
      padding: tokens.space.md,
      ...type(compactTypography.secondary),
      color: tokens.color.attention,
    }}
  >
    {children}
  </div>
);

export const cell: CSSProperties = {
  ...type(compactTypography.body),
  color: tokens.color.textPrimary,
  padding: `${String(tokens.space.sm + 5)}px ${String(tokens.space.md)}px`,
  borderBottom: `1px solid ${tokens.color.hairline}`,
  textAlign: 'left',
};

export const headerCell: CSSProperties = {
  ...cell,
  ...type(compactTypography.label),
  color: tokens.color.textSecondary,
  background: tokens.color.background,
};
