import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShioriFields } from '../src/core/parser.ts';

describe('parseShioriFields', () => {
  it('parses basic key=value pairs', () => {
    const result = parseShioriFields('ref=SUP-1234 kind=waive');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.kind, 'waive');
  });

  it('parses ref with colon (JIRA-style)', () => {
    const result = parseShioriFields('ref=JIRA:PROJ-123 kind=waive');
    assert.equal(result.ref, 'JIRA:PROJ-123');
    assert.equal(result.kind, 'waive');
  });

  it('parses quoted values with spaces', () => {
    const result = parseShioriFields('ref=SUP-1234 reason="some text with spaces"');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.reason, 'some text with spaces');
  });

  it('parses expires date', () => {
    const result = parseShioriFields('ref=SUP-1234 kind=waive expires=2026-06-01');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.kind, 'waive');
    assert.equal(result.expires, '2026-06-01');
  });

  it('returns empty ref when ref is absent', () => {
    const result = parseShioriFields('kind=waive');
    assert.equal(result.ref, '');
    assert.equal(result.kind, 'waive');
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
    assert.equal(result.kind, 'design');
  });

  it('handles YYYY-MM expires format', () => {
    const result = parseShioriFields('ref=SUP-1234 expires=2026-06');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06');
  });

  it('handles extra whitespace between pairs', () => {
    const result = parseShioriFields('  ref=SUP-1234   kind=waive  ');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.kind, 'waive');
  });
});
