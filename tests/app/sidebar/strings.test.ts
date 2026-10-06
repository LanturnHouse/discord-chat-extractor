import { describe, expect, it } from 'vitest';
import { railStrings } from '@/app/components/rail/strings';
import { sidebarStrings } from '@/app/components/sidebar/strings';
import type { StringDict, StringTable } from '@/app/i18n';

function sample(value: unknown): string {
  if (typeof value === 'function') return (value as (...args: unknown[]) => string)(3, 'x');
  return String(value);
}

describe.each([
  ['rail', railStrings],
  ['sidebar', sidebarStrings],
] as [string, StringTable<StringDict>][])('%s strings', (_name, table) => {
  it('have the same keys in Korean and English', () => {
    expect(Object.keys(table.ko).sort()).toEqual(Object.keys(table.en).sort());
  });

  it('are never empty, in either language', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const [key, value] of Object.entries(table[locale])) expect(sample(value).trim(), `${locale}.${key}`).not.toBe('');
    }
  });

  it('are different in the two languages (nothing was left untranslated)', () => {
    for (const [key, value] of Object.entries(table.ko)) expect(sample(value), key).not.toBe(sample(table.en[key]));
  });
});
