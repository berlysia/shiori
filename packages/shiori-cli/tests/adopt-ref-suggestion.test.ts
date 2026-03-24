import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrefixSource } from '../src/commands/adopt-cli.ts';
import type { PrefixSuggestion } from '../src/core/ref-suggestion.ts';

describe('formatPrefixSource', () => {
  it('formats registry source with usage count', () => {
    const s: PrefixSuggestion = {
      prefix: 'SUP',
      source: 'registry',
      usageCount: 5,
      reason: '5 existing ref(s) in registry',
    };
    assert.equal(formatPrefixSource(s), '5 existing ref(s)');
  });

  it('formats refPattern source', () => {
    const s: PrefixSuggestion = {
      prefix: 'JIRA',
      source: 'refPattern',
      usageCount: 0,
      reason: 'configured in refPatterns',
    };
    assert.equal(formatPrefixSource(s), 'from config');
  });

  it('formats default source with reason', () => {
    const s: PrefixSuggestion = {
      prefix: 'ADOPT',
      source: 'default',
      usageCount: 0,
      reason: 'standard prefix for adopted lint suppressions',
    };
    assert.equal(
      formatPrefixSource(s),
      'standard prefix for adopted lint suppressions',
    );
  });

  it('formats registry source with single ref', () => {
    const s: PrefixSuggestion = {
      prefix: 'DEBT',
      source: 'registry',
      usageCount: 1,
      reason: '1 existing ref(s) in registry',
    };
    assert.equal(formatPrefixSource(s), '1 existing ref(s)');
  });
});
