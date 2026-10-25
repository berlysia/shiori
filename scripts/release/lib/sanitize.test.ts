import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasForbiddenChar, sanitizeForTerminal } from './sanitize.ts';

describe('sanitizeForTerminal', () => {
  it('removes ESC, bidi and zero-width characters but keeps the rest and tabs', () => {
    assert.equal(sanitizeForTerminal('a\u001b[31mb‮c​d\te'), 'a[31mbcd\te');
  });

  it('keeps line feeds and non-ASCII text', () => {
    assert.equal(sanitizeForTerminal('日本語\nline2'), '日本語\nline2');
  });

  it('removes CR, NUL, DEL, C1, U+2028 and the BOM', () => {
    assert.equal(
      sanitizeForTerminal('a\rb\u0000c\u007fd\u0085e f﻿g'),
      'abcdefg',
    );
  });
});

describe('hasForbiddenChar', () => {
  it('is false for tab and LF and ordinary text', () => {
    assert.equal(hasForbiddenChar('a\tb\nc 日本語 😀'), false);
  });

  it('is true for each member of the set', () => {
    for (const char of [
      '\r',
      '\u0000',
      '\u001b',
      '\u007f',
      '\u0085',
      '‮',
      '⁦',
      '​',
      '⁠',
      '﻿',
      ' ',
      ' ',
    ]) {
      assert.equal(hasForbiddenChar(`a${char}`), true, JSON.stringify(char));
    }
  });
});
