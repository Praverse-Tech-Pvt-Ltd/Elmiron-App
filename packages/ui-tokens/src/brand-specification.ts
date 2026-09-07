/**
 * What the brand guideline specifies, recorded so it can be tested rather than
 * remembered.
 *
 * Two pairs were measured before this sprint and both fall short:
 *
 * | Pair            | Recorded | AA needs | Verdict                        |
 * | --------------- | -------- | -------- | ------------------------------ |
 * | Primary button  | 2.54:1   | 4.5:1    | fails every WCAG level         |
 * | Badge           | 4.33:1   | 4.5:1    | fails AA for normal text       |
 *
 * **The colour values themselves are not in the repository.** The guideline has not
 * been committed, so `foreground` and `background` are `null` here. That is
 * deliberate — a plausible-looking hex pair invented to fill the gap would be
 * indistinguishable from the real thing to everyone downstream.
 *
 * `brand-specification.test.ts` asserts every recorded ratio fails the validator.
 * When the real values arrive, fill in the two colour fields and the same test
 * begins checking that the computed ratio matches what was recorded — so either the
 * finding is confirmed against real colours, or the recorded number was wrong and
 * the build says so.
 */

import type { ContrastUsage } from './contrast.js';

export interface BrandContrastSpecification {
  /** What the pair is used for, in the guideline's own terms. */
  readonly name: string;
  /** The ratio measured from the guideline before this sprint. */
  readonly recordedRatio: number;
  /** Which WCAG requirement applies to this use. */
  readonly usage: ContrastUsage;
  /** `null` until the brand guideline is committed. Do not invent a value. */
  readonly foreground: string | null;
  /** `null` until the brand guideline is committed. Do not invent a value. */
  readonly background: string | null;
}

export const brandContrastSpecifications: readonly BrandContrastSpecification[] = [
  {
    name: 'primary button label on primary button fill',
    recordedRatio: 2.54,
    usage: 'text',
    foreground: null,
    background: null,
  },
  {
    name: 'badge label on badge fill',
    recordedRatio: 4.33,
    usage: 'text',
    foreground: null,
    background: null,
  },
];
