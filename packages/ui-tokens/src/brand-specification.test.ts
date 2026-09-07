import { describe, expect, it } from 'vitest';
import { brandContrastSpecifications } from './brand-specification.js';
import { contrastRatio, evaluateContrast, formatRatio, meetsContrast } from './contrast.js';

/**
 * This file is the control, not the note.
 *
 * The finding "the brand's primary button is 2.54:1 and fails WCAG" is worth
 * nothing as a sentence in a report — the next person pastes the brand value in and
 * nobody notices. Here it fails the build.
 */
describe('the brand guideline as recorded', () => {
  it.each(brandContrastSpecifications)(
    'rejects $name at $recordedRatio:1',
    ({ recordedRatio, usage }) => {
      expect(meetsContrast(recordedRatio, usage)).toBe(false);
    },
  );

  it('rejects the primary button at every WCAG level and size', () => {
    // 2.54 is below 3:1, so it fails even the large-text and non-text floors. There
    // is no reading of the guideline under which this pair is usable.
    const primary = brandContrastSpecifications[0];
    expect(primary?.recordedRatio).toBe(2.54);
    for (const usage of ['text', 'large-text', 'non-text'] as const) {
      expect(meetsContrast(2.54, usage, 'AA')).toBe(false);
      expect(meetsContrast(2.54, usage, 'AAA')).toBe(false);
    }
  });

  it('rejects the badge for normal text, which is what it is used for', () => {
    // 4.33 clears the 3:1 large-text floor. A badge label is not large text, so the
    // applicable requirement is 4.5 and it misses. Recorded explicitly because
    // "it passes at some size" is exactly how this one gets waved through.
    expect(meetsContrast(4.33, 'text')).toBe(false);
    expect(meetsContrast(4.33, 'large-text')).toBe(true);
  });

  it('has no half-filled entry — a pair has both colours or neither', () => {
    for (const spec of brandContrastSpecifications) {
      expect(spec.foreground === null).toBe(spec.background === null);
    }
  });

  it('verifies the recorded ratio against real colours once they are committed', () => {
    // Vacuous today, by design: no brand colours are in the repository. The moment
    // someone fills in a pair, this begins asserting that the guideline's own
    // colours produce the ratio that was recorded — and that they still fail.
    for (const spec of brandContrastSpecifications) {
      if (spec.foreground === null || spec.background === null) continue;

      const measured = contrastRatio(spec.foreground, spec.background);
      expect(
        measured,
        `${spec.name}: recorded ${String(spec.recordedRatio)}:1, measured ${formatRatio(measured)}`,
      ).toBeCloseTo(spec.recordedRatio, 2);
      expect(evaluateContrast(spec.foreground, spec.background, spec.usage).passes).toBe(false);
    }
  });
});
