import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import type { Catalogues, Language } from './translate';

/**
 * `FE-W140` — the three catalogues, and the one list of languages the app offers.
 *
 * `en.json` is the SOURCE: every key the app uses, in the words the app ships. `hi.json` and
 * `mr.json` carry exactly the same keys, and the client's translators fill their values through
 * `pnpm i18n:export` / `pnpm i18n:import` (`docs/operator/translations.md`). Nothing else writes
 * them, and nothing in this repository machine-translates them.
 *
 * **What is NOT in any catalogue, by rule: the consent screen's doctor-facing words** — the
 * question, the two panels, the details, and the notice itself. Those are legal text. The notice
 * comes only from `consent_text_versions` (versioned, hashed, published by the operator), and the
 * framing stays English until an approved translation arrives through that same route (see
 * `singleLanguageNote` in `apps/field/src/consent/content.ts`). `catalogue.test.ts` refuses a
 * `t()` call in those files.
 */
export type MessageKey = keyof typeof en;

/**
 * A key as `t()` accepts it: a plain key as itself, and a `_one` / `_other` pair by its base
 * (`today.stopsLeft`), which is how a plural is asked for.
 */
type AskedAs<K> = K extends `${infer Base}_one` ? Base : K extends `${string}_other` ? never : K;

/** Every key `t()` accepts. */
export type TextKey = AskedAs<MessageKey>;

export const CATALOGUES: Catalogues = { en, hi, mr };

export interface LanguageInfo {
  readonly code: Language;
  /** The language's own name, in its own script — what a reader of it looks for. */
  readonly name: string;
  /** The English name, for the "waiting for translation" line and the translators' file. */
  readonly englishName: string;
}

/**
 * The order the Settings rows are drawn in. The names are not in the catalogue: a rep who chose a
 * language they cannot read must still find their own, so each is always written in itself.
 */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', name: 'English', englishName: 'English' },
  { code: 'hi', name: 'हिन्दी', englishName: 'Hindi' },
  { code: 'mr', name: 'मराठी', englishName: 'Marathi' },
];
