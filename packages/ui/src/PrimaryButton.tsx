import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * The primary variant of `Button`, kept under its own name because every screen
 * written before Phase 1 landed calls it.
 *
 * It holds no styling of its own. It used to carry a hardcoded `minHeight: 48` and
 * an `opacity: 0.75` press state, both of which predate the design and contradict
 * it — §04 puts a primary at 60, §05 says press darkens the fill and never lightens
 * it. Fixing those once in `Button` fixed them on every screen, which is the
 * argument for the forward over a second implementation.
 *
 * Two differences from `Button`, both deliberate:
 *
 * - **`disabled` and `note` are required together**, as a plain pair rather than
 *   as `Button`'s discriminated union. §05 pairs every disabled control with a
 *   reason line, and a caller whose disabled state is computed — `busy || email
 *   === ''` — cannot satisfy a union that needs the literal `true`. Requiring both
 *   props gets the same guarantee for a dynamic boolean.
 * - **The note renders only while disabled.** On `Button` a note is also the
 *   offline line under an enabled action ("will sync later"); here it is
 *   specifically the reason the button cannot be pressed, so it appears and
 *   disappears with the disabled state.
 *
 * There is deliberately no default reason. An invented line — "Not available yet."
 * under a button whose label already says why — is worse than no line: it reads as
 * real copy, so nobody goes looking for the sentence that should have been there.
 *
 * New screens should reach for `Button` directly: it carries the other three
 * variants and the loading state.
 */
export type PrimaryButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
} & (
  | {
      readonly disabled: boolean;
      /** Why it cannot be pressed. Shown only while `disabled`. */
      readonly note: string;
    }
  | { readonly disabled?: undefined; readonly note?: undefined }
);

export const PrimaryButton = ({ label, onPress, disabled, note }: PrimaryButtonProps): ReactNode =>
  disabled === true ? (
    <Button disabled label={label} note={note} onPress={onPress} variant="primary" />
  ) : (
    <Button label={label} onPress={onPress} variant="primary" />
  );
