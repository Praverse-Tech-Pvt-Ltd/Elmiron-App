import { describe, expect, it, vi } from 'vitest';
import type { OemFamily } from './oem';
import { allSettingsIntents, intentsFor, isExpressible, SUPPORTED_TARGET_KINDS } from './intents';
import type { SettingsIntent } from './intents';
import { launchSettings, nullLauncher, offerableIntents } from './launch';
import type { SettingsLauncher } from './launch';

const FAMILIES: readonly OemFamily[] = ['xiaomi', 'oppo', 'vivo', 'realme', 'unknown'];

/** A device that resolves everything — the optimistic case, rarely the real one. */
const permissive: SettingsLauncher = {
  probe: () => Promise.resolve(true),
  launch: () => Promise.resolve(),
};

/** A device that resolves nothing and throws on launch. The common real case. */
const hostile: SettingsLauncher = {
  probe: () => Promise.resolve(false),
  launch: () => Promise.reject(new Error('ActivityNotFoundException')),
};

const componentIntent: SettingsIntent = {
  id: 'test-component',
  family: 'xiaomi',
  destination: 'Autostart',
  target: {
    kind: 'component',
    packageName: 'com.miui.securitycenter',
    activity: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
  },
};

const actionIntent: SettingsIntent = {
  id: 'test-action',
  family: 'xiaomi',
  destination: 'Battery optimisation',
  target: { kind: 'action', action: 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS' },
};

const appSettingsIntent: SettingsIntent = {
  id: 'test-app-settings',
  family: 'xiaomi',
  destination: 'App info',
  target: { kind: 'app-settings' },
};

describe('the intent table', () => {
  it('gives every family at least one intent, including unknown', () => {
    for (const family of FAMILIES) {
      expect(intentsFor(family).length, `${family} has no intents`).toBeGreaterThan(0);
    }
  });

  it('uses ids that are unique across the whole table', () => {
    // Ids key the per-step shortcut. A duplicate silently attaches one step's button
    // to another step's destination, which is unreviewable from the screen.
    const ids = allSettingsIntents().map((intent) => intent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every intent under the family it is named for', () => {
    for (const family of FAMILIES) {
      for (const intent of intentsFor(family)) {
        expect(intent.family).toBe(family);
      }
    }
  });

  it('keeps Realme and Oppo as separate rows even where the component matches', () => {
    // The lineage is shared; the rows are not. A Realme correction must not reach
    // Oppo by side effect.
    const realme = intentsFor('realme').map((i) => i.id);
    const oppo = intentsFor('oppo').map((i) => i.id);
    expect(realme.some((id) => oppo.includes(id))).toBe(false);
  });

  it('routes every app-info row through app-settings, never a bare action', () => {
    // ACTION_APPLICATION_DETAILS_SETTINGS without its `package:` data URI resolves,
    // launches and lands nowhere useful, and `sendIntent` cannot set data. A row that
    // regressed to a bare action would still pass every other test in this file while
    // giving the MR a button that appears to work and does nothing.
    for (const intent of allSettingsIntents()) {
      if (intent.destination !== 'App info') continue;
      expect(intent.target.kind, `${intent.id} must be app-settings`).toBe('app-settings');
    }
  });

  it('declares component targets as inexpressible on this build', () => {
    // Recorded as an assertion so that adding expo-intent-launcher without widening
    // SUPPORTED_TARGET_KINDS — or widening it without the module — fails here rather
    // than on a Xiaomi.
    expect(SUPPORTED_TARGET_KINDS).toEqual(['action', 'app-settings']);
    expect(isExpressible(componentIntent)).toBe(false);
    expect(isExpressible(actionIntent)).toBe(true);
    expect(isExpressible(appSettingsIntent)).toBe(true);
  });
});

describe('offerableIntents — resolve before offering', () => {
  it('offers nothing on a device that resolves nothing', async () => {
    expect(await offerableIntents(intentsFor('xiaomi'), hostile)).toEqual([]);
  });

  it('offers only the expressible intents even when the device says yes to all', async () => {
    // The permissive launcher would resolve the component intents too. They are still
    // withheld, because this build cannot form the intent to launch them — offering a
    // button whose press can only fail is the defect, not a lenient device.
    const offered = await offerableIntents(intentsFor('xiaomi'), permissive);
    expect(offered.length).toBeGreaterThan(0);
    for (const intent of offered) {
      expect(intent.target.kind).not.toBe('component');
    }
  });

  it('treats a probe that rejects as "not offerable" rather than an error', async () => {
    // Android 11 package visibility makes a rejected or false probe the NORMAL answer
    // for another app's activity. Surfacing it would put a warning on screen for a
    // device behaving exactly as Android intends.
    const exploding: SettingsLauncher = {
      probe: () => Promise.reject(new Error('package visibility')),
      launch: () => Promise.resolve(),
    };
    await expect(offerableIntents(intentsFor('oppo'), exploding)).resolves.toEqual([]);
  });

  it('preserves table order so the buttons match the numbered steps', async () => {
    const offered = await offerableIntents(intentsFor('vivo'), permissive);
    const expected = intentsFor('vivo')
      .filter(isExpressible)
      .map((intent) => intent.id);
    expect(offered.map((intent) => intent.id)).toEqual(expected);
  });

  it('probes concurrently rather than in series', async () => {
    // Three probes per screen in series is a visible delay before the buttons appear.
    let inFlight = 0;
    let peak = 0;
    const counting: SettingsLauncher = {
      probe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return true;
      },
      launch: () => Promise.resolve(),
    };
    await offerableIntents(intentsFor('realme'), counting);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('launchSettings — the flow that must not throw', () => {
  it('never throws when the launcher throws ActivityNotFoundException', async () => {
    // THE TEST THIS SPRINT EXISTS FOR.
    //
    // A raw startActivity on an unresolvable component throws, and an unhandled throw
    // here crashes the app on the onboarding settings screen, on first run, on the
    // exact devices this feature was built for.
    await expect(launchSettings(actionIntent, hostile)).resolves.toBe('failed');
  });

  it('reports an inexpressible target as unresolvable without calling the launcher', async () => {
    const launch = vi.fn(() => Promise.resolve());
    const spy: SettingsLauncher = { probe: () => Promise.resolve(true), launch };
    expect(await launchSettings(componentIntent, spy)).toBe('unresolvable');
    expect(launch).not.toHaveBeenCalled();
  });

  it('reports success as opened', async () => {
    expect(await launchSettings(actionIntent, permissive)).toBe('opened');
  });

  it('survives a launcher that throws synchronously rather than rejecting', async () => {
    // A native module that throws before returning a promise is not a rejected
    // promise, and a try/catch around a bare `await` is what covers both. Asserted
    // because the two failure shapes are easy to conflate and only one is obvious.
    const synchronousThrow: SettingsLauncher = {
      probe: () => Promise.resolve(true),
      launch: () => {
        throw new Error('ActivityNotFoundException');
      },
    };
    await expect(launchSettings(actionIntent, synchronousThrow)).resolves.toBe('failed');
  });

  it.each(FAMILIES)('cannot throw for any intent of family %s', async (family) => {
    // Exhaustive over the table rather than over a sample: a row added later with a
    // shape nobody considered is covered by this the day it lands.
    for (const intent of intentsFor(family)) {
      await expect(launchSettings(intent, hostile)).resolves.toMatch(/unresolvable|failed/u);
    }
  });

  it('rejects nothing through the nullLauncher either', async () => {
    for (const intent of allSettingsIntents()) {
      await expect(launchSettings(intent, nullLauncher)).resolves.not.toBe('opened');
    }
  });
});
