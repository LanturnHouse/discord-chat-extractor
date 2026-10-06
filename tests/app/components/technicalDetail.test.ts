import { describe, expect, it } from 'vitest';
import { technicalDetail } from '@/app/components/common/technicalDetail';

describe('technicalDetail', () => {
  it('passes a plain engine message through as one line', () => {
    expect(technicalDetail("TypeError: Cannot read properties of undefined (reading 'split')")).toBe("TypeError: Cannot read properties of undefined (reading 'split')");
    expect(technicalDetail('first line\n   second\tline')).toBe('first line second line');
  });

  it('is undefined when there is nothing to show', () => {
    expect(technicalDetail('')).toBeUndefined();
    expect(technicalDetail(' \n\t ')).toBeUndefined();
  });

  it('drops the query string and the fragment of every URL (they carry tokens and ids), keeping host and path', () => {
    const text = technicalDetail('Failed to fetch https://cdn.example.com/a/b.png?ex=65f3a&hm=abcdef&token=secret and http://localhost:5173/app.html#access_token=xyz done');
    expect(text).toBe('Failed to fetch https://cdn.example.com/a/b.png and http://localhost:5173/app.html done');
    expect(text).not.toMatch(/secret|access_token|ex=/);
  });

  it('redacts anything that looks like a Discord token or any other long unbroken token', () => {
    // Assembled from pieces on purpose: the source must never contain a literal shaped like a real credential
    // (secret scanners, e.g. GitHub push protection, flag those even when they are obviously fake).
    const user = ['MTA2NzQyNzY1MzQ1Njc4OTAx', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');
    const mfa = ['mfa', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join('.');
    const opaque = ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dcAbCdEfGh'].join('_');
    const text = technicalDetail(`bad ${user} and ${mfa} and ${opaque} end`) ?? '';
    expect(text).toBe('bad [redacted] and [redacted] and [redacted] end');
  });

  it('replaces snowflake ids like the API errors do, so the text is safe to paste into a bug report', () => {
    expect(technicalDetail('channel 123456789012345678 of guild 987654321098765432 not found, status 404')).toBe('channel <id> of guild <id> not found, status 404');
  });

  it('keeps short words, numbers and identifiers alone', () => {
    expect(technicalDetail('Cannot convert abc to a BigInt at line 12345')).toBe('Cannot convert abc to a BigInt at line 12345');
    expect(technicalDetail('Unexpected token < in JSON at position 0')).toBe('Unexpected token < in JSON at position 0');
  });

  it('clips a very long message', () => {
    const text = technicalDetail('word '.repeat(200)) ?? '';
    expect(text.length).toBe(301);
    expect(text.endsWith('…')).toBe(true);
  });
});
