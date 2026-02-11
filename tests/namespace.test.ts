import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRef, resolveRefUrl } from '../src/core/namespace.ts';

describe('parseRef', () => {
  it('parses namespaced ref with uppercase prefix', () => {
    const result = parseRef('JIRA:PROJ-123');
    assert.equal(result.namespace, 'JIRA');
    assert.equal(result.id, 'PROJ-123');
    assert.equal(result.raw, 'JIRA:PROJ-123');
  });

  it('parses short namespace', () => {
    const result = parseRef('A:B');
    assert.equal(result.namespace, 'A');
    assert.equal(result.id, 'B');
  });

  it('parses ADR namespace', () => {
    const result = parseRef('ADR:0007');
    assert.equal(result.namespace, 'ADR');
    assert.equal(result.id, '0007');
  });

  it('returns undefined namespace for no colon', () => {
    const result = parseRef('SUP-1234');
    assert.equal(result.namespace, undefined);
    assert.equal(result.id, 'SUP-1234');
    assert.equal(result.raw, 'SUP-1234');
  });

  it('returns undefined namespace for lowercase prefix', () => {
    const result = parseRef('abc:def');
    assert.equal(result.namespace, undefined);
    assert.equal(result.id, 'abc:def');
  });

  it('returns undefined namespace for mixed case prefix', () => {
    const result = parseRef('Jira:PROJ-123');
    assert.equal(result.namespace, undefined);
    assert.equal(result.id, 'Jira:PROJ-123');
  });

  it('handles empty string', () => {
    const result = parseRef('');
    assert.equal(result.namespace, undefined);
    assert.equal(result.id, '');
    assert.equal(result.raw, '');
  });

  it('handles namespace with digits', () => {
    const result = parseRef('GH2:42');
    assert.equal(result.namespace, 'GH2');
    assert.equal(result.id, '42');
  });

  it('handles colon-only id after namespace', () => {
    const result = parseRef('NS:');
    assert.equal(result.namespace, 'NS');
    assert.equal(result.id, '');
  });

  it('handles multiple colons (splits on first)', () => {
    const result = parseRef('NS:foo:bar');
    assert.equal(result.namespace, 'NS');
    assert.equal(result.id, 'foo:bar');
  });
});

describe('resolveRefUrl', () => {
  const namespaces = {
    JIRA: { urlTemplate: 'https://jira.example.com/browse/{id}' },
    ADR: { urlTemplate: 'docs/decisions/{id}.md' },
  };

  it('resolves JIRA ref to URL', () => {
    const url = resolveRefUrl('JIRA:PROJ-123', namespaces);
    assert.equal(url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('resolves ADR ref to path', () => {
    const url = resolveRefUrl('ADR:0007', namespaces);
    assert.equal(url, 'docs/decisions/0007.md');
  });

  it('returns undefined for ref without namespace', () => {
    const url = resolveRefUrl('SUP-1234', namespaces);
    assert.equal(url, undefined);
  });

  it('returns undefined for unknown namespace', () => {
    const url = resolveRefUrl('GH:42', namespaces);
    assert.equal(url, undefined);
  });

  it('returns undefined when namespaces is undefined', () => {
    const url = resolveRefUrl('JIRA:PROJ-123', undefined);
    assert.equal(url, undefined);
  });

  it('returns undefined for lowercase prefix (not a namespace)', () => {
    const url = resolveRefUrl('abc:def', namespaces);
    assert.equal(url, undefined);
  });
});
