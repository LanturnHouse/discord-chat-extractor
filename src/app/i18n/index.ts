/** Public i18n entry for components: `defineStrings` to declare strings, `useStrings` to read them in the current locale. */
import { useAppStore } from '../state/store';
import { type Locale, type StringDict, type StringTable } from './core';

export { LOCALES, defineStrings, getStrings, resolveLocale } from './core';
export type { Locale, StringDict, StringTable, StringValue } from './core';
export { common, describeError } from './common';

/** The language in use (`prefs.locale`, with 'auto' resolved from the browser language). */
export function useLocale(): Locale {
  return useAppStore((state) => state.locale);
}

/** Strings of one area in the current locale. The returned object is stable for a given locale. */
export function useStrings<S extends StringDict>(table: StringTable<S>): S {
  return table[useLocale()];
}
