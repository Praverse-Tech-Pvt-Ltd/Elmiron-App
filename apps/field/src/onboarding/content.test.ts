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
  notificationTypes,
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

/**
 * **FE-D12 item 2.** A3 promised "Coaching notes" while Coaching is hidden, and "when a recording
 * you made is confirmed, or when consent was withdrawn" while consultation recording is off. A
 * permission screen that names a message the app cannot send is asking consent for something
 * that does not exist. Each of those two lines now follows its feature's flag, so it returns by
 * itself when the feature is switched on, and the cap counts only what is shown.
 */
describe('A3 promises only what this build can send (FE-D12 item 2)', () => {
  const ids = (flags: { coachingEnabled: boolean; recordingEnabled: boolean }) =>
    notificationTypes(flags).map((type) => type.id);

  it('with Coaching hidden and recording off, as in this build: neither line', () => {
    expect(ids({ coachingEnabled: false, recordingEnabled: false })).toEqual([
      'day-plan',
      'sync-outcome',
    ]);
  });

  it('with both switched on: all four, in the design order', () => {
    expect(ids({ coachingEnabled: true, recordingEnabled: true })).toEqual([
      'day-plan',
      'sync-outcome',
      'consent-outcome',
      'coaching',
    ]);
  });

  it('each line follows its own flag', () => {
    expect(ids({ coachingEnabled: true, recordingEnabled: false })).toContain('coaching');
    expect(ids({ coachingEnabled: true, recordingEnabled: false })).not.toContain(
      'consent-outcome',
    );
    expect(ids({ coachingEnabled: false, recordingEnabled: true })).toContain('consent-outcome');
    expect(ids({ coachingEnabled: false, recordingEnabled: true })).not.toContain('coaching');
  });

  it('caps and counts what is shown, not the design’s four', () => {
    const shown = notificationTypes({ coachingEnabled: false, recordingEnabled: false });
    expect(capSentence(shown.length)).toBe('At most 2 a day, and nothing outside these two.');
    expect(capSentence(4)).toBe('At most 4 a day, and nothing outside these four.');
  });
});
