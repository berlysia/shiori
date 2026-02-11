import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShioriFields } from '../src/core/parser.ts';

describe('parseShioriFields', () => {
  it('parses basic key=value pairs', () => {
    const result = parseShioriFields('ref=SUP-1234 kind=waive');
    assert.equal(result.ref, 'SUP-1234');
  });

  it('parses ref with colon (JIRA-style)', () => {
    const result = parseShioriFields('ref=JIRA:PROJ-123 kind=waive');
    assert.equal(result.ref, 'JIRA:PROJ-123');
  });

  it('parses quoted values with spaces', () => {
    const result = parseShioriFields(
      'ref=SUP-1234 reason="some text with spaces"',
    );
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.reason, 'some text with spaces');
  });

  it('parses expires date', () => {
    const result = parseShioriFields(
      'ref=SUP-1234 kind=waive expires=2026-06-01',
    );
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06-01');
  });

  it('returns empty ref when ref is absent', () => {
    const result = parseShioriFields('kind=waive');
    assert.equal(result.ref, '');
  });

  it('returns empty ref for empty input', () => {
    const result = parseShioriFields('');
    assert.equal(result.ref, '');
  });

  it('handles single-quoted values', () => {
    const result = parseShioriFields("ref=X reason='single quoted'");
    assert.equal(result.ref, 'X');
    assert.equal(result.reason, 'single quoted');
  });

  it('handles ADR-style ref', () => {
    const result = parseShioriFields('ref=ADR:0007 kind=design');
    assert.equal(result.ref, 'ADR:0007');
  });

  it('handles YYYY-MM expires format', () => {
    const result = parseShioriFields('ref=SUP-1234 expires=2026-06');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06');
  });

  it('handles extra whitespace between pairs', () => {
    const result = parseShioriFields('  ref=SUP-1234   kind=waive  ');
    assert.equal(result.ref, 'SUP-1234');
  });

  describe('bare ref shorthand', () => {
    it('treats single token without = as bare ref', () => {
      const result = parseShioriFields('SUP-1234');
      assert.equal(result.ref, 'SUP-1234');
    });

    it('treats namespaced token as bare ref', () => {
      const result = parseShioriFields('JIRA:PROJ-123');
      assert.equal(result.ref, 'JIRA:PROJ-123');
    });

    it('treats ADR-style token as bare ref', () => {
      const result = parseShioriFields('ADR:0007');
      assert.equal(result.ref, 'ADR:0007');
    });

    it('does not apply shorthand when = is present', () => {
      const result = parseShioriFields('kind=waive');
      assert.equal(result.ref, '');
    });

    it('does not apply shorthand to empty input', () => {
      const result = parseShioriFields('');
      assert.equal(result.ref, '');
    });

    it('does not apply shorthand to multi-word input without =', () => {
      const result = parseShioriFields('some text');
      assert.equal(result.ref, '');
    });
  });

  describe('errors', () => {
    it('returns empty errors for valid input', () => {
      const result = parseShioriFields('ref=SUP-1234');
      assert.deepEqual(result.errors, []);
    });

    it('returns empty errors for bare ref shorthand', () => {
      const result = parseShioriFields('SUP-1234');
      assert.deepEqual(result.errors, []);
    });

    it('returns empty errors for empty input', () => {
      const result = parseShioriFields('');
      assert.deepEqual(result.errors, []);
    });

    it('detects empty value for ref=', () => {
      const result = parseShioriFields('ref= expires=2026-06');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /empty value.*ref/);
    });

    it('detects empty value for ref= at end of input', () => {
      const result = parseShioriFields('ref=');
      assert.equal(result.ref, '');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /empty value.*ref/);
    });

    it('detects missing key before =', () => {
      const result = parseShioriFields('=invalid');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /missing key/);
    });

    it('detects unterminated quote', () => {
      const result = parseShioriFields('ref=SUP-1 reason="unterminated');
      assert.equal(result.ref, 'SUP-1');
      assert.equal(result.reason, 'unterminated');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /unterminated quote.*reason/);
    });

    it('collects multiple errors', () => {
      const result = parseShioriFields('=bad ref=');
      assert.equal(result.errors.length, 2);
    });
  });
});
