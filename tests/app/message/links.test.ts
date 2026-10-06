import { describe, expect, it } from 'vitest';
import { linkHost } from '@/app/components/message/links';

describe('linkHost', () => {
  it('is the site a link leads to, with its port', () => {
    expect(linkHost('https://example.com/images/cat.png')).toBe('example.com');
    expect(linkHost('https://cdn.example.com:8443/a?b=c#d')).toBe('cdn.example.com:8443');
    expect(linkHost('http://user@example.com/')).toBe('example.com');
  });

  it('falls back to the text itself when it is no URL or has no host', () => {
    expect(linkHost('not a url')).toBe('not a url');
    expect(linkHost('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });
});
