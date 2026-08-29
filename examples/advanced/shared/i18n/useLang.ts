/**
 * Tiny i18n runtime for the reference stand. Zero deps.
 *
 * - `getLang()` returns the current language from localStorage, defaulting to `en`.
 * - `setLang(lang)` writes localStorage + triggers a full page reload — every
 *   MFE re-hydrates against the new language on next render. No broker events,
 *   no runtime hot-swap machinery. Reload is snappy on a well-cached SPA and
 *   keeps the machinery small.
 * - `t(dict, key)` picks the right value from an inline `Record<Lang, Record<Key,string>>`
 *   dictionary. Falls back to English if the current-lang key is missing.
 *
 * Each MFE keeps its own dictionaries next to the components that use them —
 * no central catalog, no code-splitting per locale. The strings are small
 * enough that shipping both languages in every bundle is cheaper than
 * dynamic import ceremony.
 */

export type Lang = 'en' | 'ru';

export const LANGS: ReadonlyArray<Lang> = ['en', 'ru'];
export const DEFAULT_LANG: Lang = 'en';
const STORAGE_KEY = 'hedwig-lang';

export function getLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'ru' ? 'ru' : 'en';
}

export function setLang(lang: Lang): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, lang);
  window.location.reload();
}

export function t<K extends string>(
  dict: Record<Lang, Record<K, string>>,
  key: K,
): string {
  const lang = getLang();
  return dict[lang][key] ?? dict.en[key];
}
