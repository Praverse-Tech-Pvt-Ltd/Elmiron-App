/**
 * `FE-W140`–`FE-W141` — the string catalogue, importable without React Native.
 *
 * Published as `@fieldforce/ui/i18n` as well as through the package root, because the field app's
 * plain modules (`settings/content.ts`, `sync/indicator.ts`) run under vitest in node, where the
 * package root — which pulls in every component — cannot load.
 */
export { CATALOGUES, LANGUAGES } from './catalogue';
export type { LanguageInfo, MessageKey, TextKey } from './catalogue';
export { createLanguageStore, isLanguage, languageStore, t } from './store';
export type { LanguageStore } from './store';
export { useLanguage, useT } from './useT';
export { placeholdersOf, pluralCategory, progressOf, translate } from './translate';
export type { Catalogue, Catalogues, Language, Params, Progress } from './translate';
