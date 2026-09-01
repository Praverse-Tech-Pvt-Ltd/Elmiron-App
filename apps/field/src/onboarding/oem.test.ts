import { describe, expect, it } from 'vitest';
import { detectOem } from './oem';
import type { DeviceIdentity, OemFamily } from './oem';

/**
 * Every branch of the detection table, and the one that costs support calls.
 *
 * The fingerprints below are the realistic shapes — `brand` and `manufacturer` as
 * Android actually reports them, casing included — rather than tidy lowercase
 * strings that would pass a matcher this test is supposed to be checking.
 */

describe('detectOem — the five outcomes', () => {
  it.each<readonly [string, DeviceIdentity, OemFamily]>([
    ['Xiaomi flagship', { manufacturer: 'Xiaomi', brand: 'Xiaomi', model: 'M2101K9G' }, 'xiaomi'],
    ['Redmi is Xiaomi', { manufacturer: 'Xiaomi', brand: 'Redmi', model: 'M2006C3LG' }, 'xiaomi'],
    ['Poco is Xiaomi', { manufacturer: 'Xiaomi', brand: 'POCO', model: 'M2102J20SG' }, 'xiaomi'],
    ['Oppo', { manufacturer: 'OPPO', brand: 'OPPO', model: 'CPH2219' }, 'oppo'],
    ['Vivo', { manufacturer: 'vivo', brand: 'vivo', model: 'V2027' }, 'vivo'],
    ['Realme', { manufacturer: 'realme', brand: 'realme', model: 'RMX3081' }, 'realme'],
  ])('maps %s', (_name, identity, expected) => {
    expect(detectOem(identity)).toBe(expected);
  });

  it.each<readonly [string, DeviceIdentity]>([
    ['Samsung', { manufacturer: 'samsung', brand: 'samsung', model: 'SM-G991B' }],
    ['a Pixel', { manufacturer: 'Google', brand: 'google', model: 'Pixel 7' }],
    [
      'the emulator this repo runs on',
      { manufacturer: 'Google', brand: 'google', model: 'sdk_gphone64_x86_64' },
    ],
    ['a device reporting nothing at all', {}],
    ['explicit nulls', { manufacturer: null, brand: null, model: null }],
    ['empty strings', { manufacturer: '', brand: '', model: '' }],
  ])('returns unknown for %s — an outcome, not a failure', (_name, identity) => {
    // `unknown` is the majority case worldwide and routes to generic guidance. It is
    // asserted here rather than left as "whatever falls through", because a later
    // refactor that threw or returned undefined would otherwise go unnoticed.
    expect(detectOem(identity)).toBe('unknown');
  });
});

describe('detectOem — brand wins over manufacturer', () => {
  it('sends a Realme reporting manufacturer=OPPO to realme, not oppo', () => {
    // THE TRAP. Realme was spun out of Oppo and Realme handsets have historically
    // reported OPPO as manufacturer while reporting realme as brand.
    //
    // Reading manufacturer first returns 'oppo' here, which is a passing-looking
    // implementation that walks a Realme user through ColorOS's three-settings-in-
    // three-places flow. Realme UI puts two settings on one screen. Nothing on their
    // phone matches what the app is telling them to tap.
    expect(detectOem({ manufacturer: 'OPPO', brand: 'realme', model: 'RMX3085' })).toBe('realme');
  });

  it('still reads manufacturer when brand carries nothing useful', () => {
    // Brand-first does not mean brand-only. A blank or unrecognised brand must fall
    // through rather than short-circuit to unknown.
    expect(detectOem({ manufacturer: 'Xiaomi', brand: '', model: 'M2101K9G' })).toBe('xiaomi');
    expect(detectOem({ manufacturer: 'vivo', brand: 'unlisted-brand' })).toBe('vivo');
  });

  it('leaves a manufacturer=realme device with no brand as unknown', () => {
    // realme is deliberately absent from the manufacturer table. Reaching here means
    // brand carried nothing recognisable, and routing to a specific ROM's
    // instructions on the strength of the field we have just called unreliable is
    // the Realme/Oppo mistake made in the other direction. Generic guidance instead.
    expect(detectOem({ manufacturer: 'realme', brand: '' })).toBe('unknown');
  });
});

describe('detectOem — normalisation and hostile input', () => {
  it.each(['  Xiaomi  ', 'XIAOMI', 'xIaOmI', '\tXiaomi\n'])('trims and lowercases %j', (brand) => {
    expect(detectOem({ brand })).toBe('xiaomi');
  });

  it('matches whole tokens, never substrings', () => {
    // A model or brand string that merely CONTAINS a vendor name is not that vendor.
    // A false positive is worse than unknown: it shows instructions for a ROM the
    // device does not run, and the MR concludes the app is broken.
    expect(detectOem({ brand: 'vivobook', manufacturer: 'asus' })).toBe('unknown');
    expect(detectOem({ brand: 'oppointment', manufacturer: 'nobody' })).toBe('unknown');
  });

  it('does not resolve prototype keys to a family', () => {
    // The lookup key comes off the device. With an object literal, `constructor`
    // resolves through Object.prototype to a function, which is not undefined and
    // would be handed back as though it were an OemFamily. A Map has no prototype
    // chain to fall through, and this asserts it stays a Map.
    for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(detectOem({ brand: hostile, manufacturer: hostile })).toBe('unknown');
    }
  });

  it('never reads model — matching on individual handsets is the picker this avoids', () => {
    expect(detectOem({ brand: 'google', manufacturer: 'Google', model: 'Redmi Note 12' })).toBe(
      'unknown',
    );
  });
});
