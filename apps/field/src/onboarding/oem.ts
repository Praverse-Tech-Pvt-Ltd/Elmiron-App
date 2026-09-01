/**
 * Which Android skin this device runs, decided from the build.
 *
 * The design's premise for A5-A8 is that **the MR never picks their own phone from a
 * list.** A picker asks a question the build already answers, and asks it of someone
 * who has no reason to know whether their Realme runs "Realme UI" or "ColorOS". So
 * this is detection, and there is deliberately no override.
 *
 * **The input is a plain object, not a native module.** `react-native`'s `Platform`
 * constants are read once at the call site (`device.ts`) and passed in here. That is
 * the whole reason this file is testable under vitest with no device attached: the
 * mapping is the part with the bugs in it, and the native read is the part that
 * cannot be tested on this machine either way.
 */

/**
 * Five outcomes, and `unknown` is one of them rather than a failure.
 *
 * Most of the world is `unknown` — Samsung, OnePlus, Motorola, Nothing, every Pixel,
 * and every emulator this repo has ever run on. `unknown` gets the generic guidance
 * screen, which is a real destination and not an error state.
 */
export type OemFamily = 'xiaomi' | 'oppo' | 'vivo' | 'realme' | 'unknown';

/**
 * What Android reports about itself. Every field is optional because every field is
 * genuinely absent somewhere — `Platform.constants` is thinner on older ROMs, and a
 * test double should not have to invent values it is not exercising.
 */
export interface DeviceIdentity {
  readonly manufacturer?: string | null | undefined;
  readonly brand?: string | null | undefined;
  readonly model?: string | null | undefined;
}

/** Case-insensitive, whitespace-trimmed. `null`/`undefined` normalise to empty. */
const normalise = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * Exact tokens, never substrings.
 *
 * Substring matching is the obvious implementation and it is wrong here. "vivo"
 * occurs inside model strings that have nothing to do with the vendor, and a false
 * positive is strictly worse than `unknown`: it walks an MR through Funtouch
 * instructions that do not match anything on their screen, and they conclude the app
 * is broken. `unknown` shows generic guidance and is honest about it.
 *
 * Poco and Redmi are Xiaomi sub-brands and report themselves as such in `brand`.
 *
 * A `Map` rather than an object literal, because the key here is a string that came
 * off the device. An object lookup answers `brand: "constructor"` with a function
 * from `Object.prototype`, which is not `undefined` and would be returned as though
 * it were an `OemFamily`. A `Map` has no prototype chain to fall through.
 */
const BRAND_TOKENS = new Map<string, OemFamily>([
  ['realme', 'realme'],
  ['xiaomi', 'xiaomi'],
  ['redmi', 'xiaomi'],
  ['poco', 'xiaomi'],
  ['oppo', 'oppo'],
  ['vivo', 'vivo'],
]);

/**
 * Manufacturer is consulted **only after brand**, and that ordering is the whole
 * point of this table being separate.
 *
 * Realme was spun out of Oppo and shares its lineage, and Realme handsets have
 * historically reported `manufacturer=OPPO` while reporting `brand=realme`. Reading
 * manufacturer first therefore sends a Realme user to A6 (ColorOS) — three steps in
 * three different places, none of which match the two-settings-one-screen layout
 * Realme UI actually shows them. Brand is the field that stayed truthful, so brand
 * wins.
 *
 * `realme` is absent from this table on purpose. A Realme device reports `realme` in
 * `brand` and has already matched above; one that reaches here with an unrecognised
 * brand lands on `unknown` and gets generic guidance. Adding `realme` here would
 * route it to the Realme screen on the strength of a field this design has just
 * established is the unreliable one — which is the same mistake as reading
 * manufacturer first, made in the other direction.
 */
const MANUFACTURER_TOKENS = new Map<string, OemFamily>([
  ['xiaomi', 'xiaomi'],
  ['redmi', 'xiaomi'],
  ['poco', 'xiaomi'],
  ['oppo', 'oppo'],
  ['vivo', 'vivo'],
]);

/**
 * Map a device to its skin family.
 *
 * Brand before manufacturer. See `MANUFACTURER_TOKENS` for why that ordering is
 * load-bearing rather than stylistic.
 *
 * `model` is accepted but never read. It is in the signature because the call site
 * has it, it appears in every bug report, and adding a parameter later means
 * touching every test; matching on it would mean maintaining a list of individual
 * handsets, which is the picker this design exists to avoid.
 */
export const detectOem = (identity: DeviceIdentity): OemFamily => {
  const brandMatch = BRAND_TOKENS.get(normalise(identity.brand));
  if (brandMatch !== undefined) return brandMatch;

  return MANUFACTURER_TOKENS.get(normalise(identity.manufacturer)) ?? 'unknown';
};
