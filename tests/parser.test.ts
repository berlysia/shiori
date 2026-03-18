import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShioriFields } from '../src/core/parser.ts';

describe('parseShioriFields', () => {
  it('parses positional ref with key=value pairs', () => {
    const result = parseShioriFields('SUP-1234 kind=waive');
    assert.equal(result.ref, 'SUP-1234');
  });

  it('parses ref with colon (JIRA-style)', () => {
    const result = parseShioriFields('JIRA:PROJ-123 kind=waive');
    assert.equal(result.ref, 'JIRA:PROJ-123');
  });

  it('parses quoted values with spaces', () => {
    const result = parseShioriFields('SUP-1234 reason="some text with spaces"');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.reason, 'some text with spaces');
  });

  it('parses expires date', () => {
    const result = parseShioriFields('SUP-1234 kind=waive expires=2026-06-01');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06-01');
  });

  it('returns empty ref when only key=value pairs', () => {
    const result = parseShioriFields('kind=waive');
    assert.equal(result.ref, '');
  });

  it('returns empty ref for empty input', () => {
    const result = parseShioriFields('');
    assert.equal(result.ref, '');
  });

  it('handles single-quoted values', () => {
    const result = parseShioriFields("X reason='single quoted'");
    assert.equal(result.ref, 'X');
    assert.equal(result.reason, 'single quoted');
  });

  it('handles ADR-style ref', () => {
    const result = parseShioriFields('ADR:0007 kind=design');
    assert.equal(result.ref, 'ADR:0007');
  });

  it('handles YYYY-MM expires format', () => {
    const result = parseShioriFields('SUP-1234 expires=2026-06');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06');
  });

  it('handles extra whitespace between pairs', () => {
    const result = parseShioriFields('  SUP-1234   kind=waive  ');
    assert.equal(result.ref, 'SUP-1234');
  });

  it('parses positional ref with expires (new combined form)', () => {
    const result = parseShioriFields('SUP-1234 expires=2026-06');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06');
    assert.deepEqual(result.errors, []);
  });

  describe('positional ref', () => {
    it('treats single token without = as positional ref', () => {
      const result = parseShioriFields('SUP-1234');
      assert.equal(result.ref, 'SUP-1234');
    });

    it('treats namespaced token as positional ref', () => {
      const result = parseShioriFields('JIRA:PROJ-123');
      assert.equal(result.ref, 'JIRA:PROJ-123');
    });

    it('treats ADR-style token as positional ref', () => {
      const result = parseShioriFields('ADR:0007');
      assert.equal(result.ref, 'ADR:0007');
    });

    it('does not apply positional ref when first token has =', () => {
      const result = parseShioriFields('kind=waive');
      assert.equal(result.ref, '');
    });

    it('does not apply positional ref to empty input', () => {
      const result = parseShioriFields('');
      assert.equal(result.ref, '');
    });

    it('treats first token as positional ref in multi-word input without =', () => {
      const result = parseShioriFields('some text');
      assert.equal(result.ref, 'some');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /unexpected bare token.*text/);
    });
  });

  describe('errors', () => {
    it('returns empty errors for valid positional ref', () => {
      const result = parseShioriFields('SUP-1234');
      assert.deepEqual(result.errors, []);
    });

    it('returns empty errors for positional ref with fields', () => {
      const result = parseShioriFields('SUP-1234 expires=2026-06');
      assert.deepEqual(result.errors, []);
    });

    it('returns empty errors for empty input', () => {
      const result = parseShioriFields('');
      assert.deepEqual(result.errors, []);
    });

    it('rejects ref= as invalid key', () => {
      const result = parseShioriFields('ref=SUP-1234');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /ref.*not a valid key/);
    });

    it('rejects ref= with empty value', () => {
      const result = parseShioriFields('ref= expires=2026-06');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /ref.*not a valid key/);
      assert.equal(result.expires, '2026-06');
    });

    it('rejects ref= at end of input', () => {
      const result = parseShioriFields('ref=');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /ref.*not a valid key/);
    });

    it('detects missing key before =', () => {
      const result = parseShioriFields('=invalid');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /missing key/);
    });

    it('detects unterminated quote', () => {
      const result = parseShioriFields('SUP-1 reason="unterminated');
      assert.equal(result.ref, 'SUP-1');
      assert.equal(result.reason, 'unterminated');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /unterminated quote.*reason/);
    });

    it('collects multiple errors', () => {
      const result = parseShioriFields('=bad ref=');
      assert.equal(result.errors.length, 2);
    });

    it('rejects ref= and detects bare token after positional ref', () => {
      const result = parseShioriFields('ref=SUP-1234 ignore');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 2);
      assert.match(result.errors[0]!, /ref.*not a valid key/);
      assert.match(result.errors[1]!, /unexpected bare token.*ignore/);
    });

    it('detects unexpected bare token with multiple words after key=value', () => {
      const result = parseShioriFields('SUP-1234 kind=waive some extra');
      assert.equal(result.ref, 'SUP-1234');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /unexpected bare token.*some extra/);
    });
  });

  describe('backslash escapes in quoted values', () => {
    it('handles escaped double quotes inside double-quoted value', () => {
      const result = parseShioriFields('SUP-1234 reason="say \\"hello\\""');
      assert.equal(result.ref, 'SUP-1234');
      assert.equal(result.reason, 'say "hello"');
      assert.deepEqual(result.errors, []);
    });

    it('handles escaped backslash inside quoted value', () => {
      const result = parseShioriFields('SUP-1234 reason="path\\\\to\\\\file"');
      assert.equal(result.ref, 'SUP-1234');
      assert.equal(result.reason, 'path\\to\\file');
      assert.deepEqual(result.errors, []);
    });

    it('handles escaped single quote inside single-quoted value', () => {
      const result = parseShioriFields("SUP-1234 reason='it\\'s fine'");
      assert.equal(result.ref, 'SUP-1234');
      assert.equal(result.reason, "it's fine");
      assert.deepEqual(result.errors, []);
    });

    it('handles trailing backslash at end of quoted value as unterminated', () => {
      // Trailing backslash: i+1 is out of range, so backslash is not an escape
      // sequence but a literal char; then the loop ends without finding close quote
      const result = parseShioriFields('SUP-1234 reason="trailing\\');
      assert.equal(result.ref, 'SUP-1234');
      assert.equal(result.reason, 'trailing\\');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /unterminated quote.*reason/);
    });
  });
});
