import { describe, expect, it } from 'vitest';
import { A8_STEP_DETAIL_IS_UNSOURCED, contentFor } from './oem-content';
import type { OemFamily } from './oem';
import { intentsFor } from './intents';
import {
  DAILY_CAP,
  DAILY_CAP_IS_UNSOURCED,
  NAMES_ARE_DERIVED,
  NOTIFICATION_TYPES,
  capSentence,
} from './notifications';

const FAMILIES: readonly OemFamily[] = ['xiaomi', 'oppo', 'vivo', 'realme', 'unknown'];

describe('every family has a renderable screen', () => {
  it.each(FAMILIES)('%s has a headline, a consequence and at least two steps', (family) => {
    const content = contentFor(family);
    expect(content.headline.length).toBeGreaterThan(0);
    expect(content.consequence.length).toBeGreaterThan(0);
    expect(content.steps.length).toBeGreaterThanOrEqual(2);
    for (const step of content.steps) {
      expect(step.title.length).toBeGreaterThan(0);
    }
  });

  it('gives the four named skins their own words, never a shared generic screen', () => {
    // If a family ever fell through to the unknown copy, an MR would be told to look
    // for a setting their phone does not have — the same failure as misdetecting them.
    const generic = contentFor('unknown').headline;
    for (const family of ['xiaomi', 'oppo', 'vivo', 'realme'] as const) {
      expect(contentFor(family).headline).not.toBe(generic);
    }
  });

  it('points every step shortcut at an intent that exists for that family', () => {
    // A step naming an intentId no row provides would silently never get a button,
    // and would look identical to a device that simply did not resolve it.
    for (const family of FAMILIES) {
      const ids = intentsFor(family).map((intent) => intent.id);
      for (const step of contentFor(family).steps) {
        if (step.intentId === undefined) continue;
        expect(ids, `${family}: unknown intentId ${step.intentId}`).toContain(step.intentId);
      }
    }
  });

  it('gives Oppo three steps and Realme two, as the design distinguishes them', () => {
    // The whole reason the Realme/Oppo detection trap matters: the two screens are
    // genuinely different lengths, so getting the family wrong is visible immediately.
    expect(contentFor('oppo').steps.length).toBe(3);
    expect(contentFor('realme').steps.length).toBe(2);
  });
});

describe('the copy gaps stay visible', () => {
  it("keeps A8's step detail marked unsourced until Phase 2 is available", () => {
    // `docs/design/` is not in this repository. A8's numbered steps are not in the
    // written extract, so its step titles are derived and it carries no "What you'll
    // see" text. This flag is how that gap survives a reviewer who does not read the
    // module comment.
    expect(A8_STEP_DETAIL_IS_UNSOURCED).toBe(true);
    for (const step of contentFor('realme').steps) {
      expect(step.whatYouWillSee).toBeUndefined();
    }
  });

  it("keeps every sourced screen's What-you'll-see line", () => {
    // The other three do have it in the extract, and losing one would be a real
    // regression rather than a known gap.
    for (const family of ['xiaomi', 'oppo', 'vivo'] as const) {
      const withDetail = contentFor(family).steps.filter(
        (step) => step.whatYouWillSee !== undefined,
      );
      expect(withDetail.length).toBeGreaterThan(0);
    }
  });

  it('keeps the notification names and cap marked as not-yet-sourced', () => {
    expect(NAMES_ARE_DERIVED).toBe(true);
    expect(DAILY_CAP_IS_UNSOURCED).toBe(true);
  });
});

describe('A3 names exactly four types and caps them', () => {
  it('has four, each with a distinct name and a detail line', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(4);
    const names = NOTIFICATION_TYPES.map((type) => type.name);
    expect(new Set(names).size).toBe(4);
    for (const type of NOTIFICATION_TYPES) {
      expect(type.detail.length).toBeGreaterThan(0);
    }
  });

  it('states the cap as a number rather than a reassurance', () => {
    expect(capSentence()).toContain(String(DAILY_CAP));
    expect(capSentence()).not.toMatch(/stay updated|from time to time|occasionally/iu);
  });
});
