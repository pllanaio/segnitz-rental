import { describe, expect, it } from 'vitest';
import { safeLocalRedirect } from './auth-utils';

describe('safeLocalRedirect', () => {
  it('accepts only root-relative application destinations', () => {
    expect(safeLocalRedirect('/backend.html', '/index.html')).toBe('/backend.html');
    expect(safeLocalRedirect('/login.html#resetToken=abc', '/index.html'))
      .toBe('/login.html#resetToken=abc');
    expect(safeLocalRedirect('https://evil.example', '/index.html')).toBe('/index.html');
    expect(safeLocalRedirect('//evil.example', '/index.html')).toBe('/index.html');
    expect(safeLocalRedirect('/\\evil.example', '/index.html')).toBe('/index.html');
    expect(safeLocalRedirect('/index.html\nLocation: https://evil.example', '/index.html'))
      .toBe('/index.html');
  });
});
