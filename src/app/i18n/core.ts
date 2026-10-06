/**
 * Tiny type-safe i18n core: no library, no runtime parsing. Pure (no React, no store) so that the store itself can use it.
 * React components use `useStrings` from `@/app/i18n`.
 */

export type Locale = 'ko' | 'en';
export const LOCALES: readonly Locale[] = ['ko', 'en'];

/** A UI string, or a function that builds one from arguments (plurals, names...). */
export type StringValue = string | ((...args: never[]) => string);
export type StringDict = Readonly<Record<string, StringValue>>;

export interface StringTable<S extends StringDict> {
  readonly ko: S;
  readonly en: S;
}

/**
 * Declares the strings of one UI area. `en` is checked against the shape inferred from `ko`: a missing key, a key of a
 * different kind, or a function with other parameter types is a compile error (extra keys too, when written inline).
 * Annotate the parameters of functions in `ko` (`(n: number) => ...`); in `en` they are inferred from `ko`.
 *
 *   export const strings = defineStrings({
 *     ko: { title: '제목', count: (n: number) => `${n}개` },
 *     en: { title: 'Title', count: (n) => `${n} items` },
 *   });
 *   // in a component:  const t = useStrings(strings);  t.count(3)
 */
export function defineStrings<S extends StringDict>(table: { ko: S; en: NoInfer<S> }): StringTable<S> {
  return table;
}

export function getStrings<S extends StringDict>(table: StringTable<S>, locale: Locale): S {
  return table[locale];
}

/**
 * `prefs.locale` + the browser language -> the language actually used. An explicit preference always wins. For 'auto':
 * 'ko*' => 'ko', any other known language => 'en', and no language information at all => 'ko' (the product default,
 * docs/DECISIONS.md #28).
 */
export function resolveLocale(pref: 'auto' | Locale, browserLanguage: string | null | undefined): Locale {
  if (pref !== 'auto') return pref;
  const language = typeof browserLanguage === 'string' ? browserLanguage.trim().toLowerCase() : '';
  if (language === '') return 'ko';
  return language.startsWith('ko') ? 'ko' : 'en';
}

/** `navigator.language`, or undefined outside a browser (tests, workers). */
export function readBrowserLanguage(): string | undefined {
  return typeof navigator !== 'undefined' ? navigator.language : undefined;
}
