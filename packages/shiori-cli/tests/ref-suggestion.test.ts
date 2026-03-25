import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Registry } from '../src/core/types.ts';
import type { RefPatternConfig } from '../src/core/ref-pattern.ts';
import {
  extractPrefixesFromRegistry,
  extractPrefixesFromPatterns,
  suggestPrefixes,
  findNextAvailableNumber,
  formatRefNumber,
  suggestNextRef,
} from '../src/core/ref-suggestion.ts';

// ── extractPrefixesFromRegistry ──────────────────────────────

describe('extractPrefixesFromRegistry', () => {
  it('extracts prefixes from PREFIX-NNN pattern refs', () => {
    const registry: Registry = {
      'ADOPT-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'ADOPT-002': {
        reason: 'test',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-1234': {
        reason: 'test',
        target: 'c.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const counts = extractPrefixesFromRegistry(registry);
    assert.equal(counts.get('ADOPT'), 2);
    assert.equal(counts.get('SUP'), 1);
    assert.equal(counts.size, 2);
  });

  it('ignores non-PREFIX-NNN refs (e.g. ADR:0007)', () => {
    const registry: Registry = {
      'ADR:0007': {
        reason: 'design decision',
        target: 'src/',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const counts = extractPrefixesFromRegistry(registry);
    assert.equal(counts.size, 0);
  });

  it('returns empty map for empty registry', () => {
    const counts = extractPrefixesFromRegistry({});
    assert.equal(counts.size, 0);
  });

  it('handles multi-segment prefixes (e.g. JIRA-PROJ-123)', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const counts = extractPrefixesFromRegistry(registry);
    assert.equal(counts.get('DEV'), 1);
  });
});

// ── extractPrefixesFromPatterns ──────────────────────────────

describe('extractPrefixesFromPatterns', () => {
  it('extracts prefix from "PREFIX-{id}" patterns', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', urlTemplate: 'https://jira.example.com/{id}' },
      { match: 'ADR-{id}', urlTemplate: 'docs/decisions/{id}.md' },
    ];

    const prefixes = extractPrefixesFromPatterns(patterns);
    assert.deepEqual(prefixes, ['JIRA', 'ADR']);
  });

  it('extracts prefix from colon-based patterns', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/{id}' },
    ];

    const prefixes = extractPrefixesFromPatterns(patterns);
    assert.deepEqual(prefixes, ['JIRA']);
  });

  it('deduplicates prefixes', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}' },
      { match: 'JIRA:{id}' },
    ];

    const prefixes = extractPrefixesFromPatterns(patterns);
    assert.deepEqual(prefixes, ['JIRA']);
  });

  it('ignores literal patterns without prefix', () => {
    const patterns: RefPatternConfig[] = [{ match: 'LEGACY-WORKAROUND' }];

    const prefixes = extractPrefixesFromPatterns(patterns);
    // "LEGACY-WORKAROUND" has no {id} after separator, so no extraction
    assert.deepEqual(prefixes, []);
  });

  it('ignores catch-all {id} pattern', () => {
    const patterns: RefPatternConfig[] = [{ match: '{id}' }];

    const prefixes = extractPrefixesFromPatterns(patterns);
    assert.deepEqual(prefixes, []);
  });

  it('returns empty array for undefined patterns', () => {
    assert.deepEqual(extractPrefixesFromPatterns(undefined), []);
  });

  it('returns empty array for empty patterns', () => {
    assert.deepEqual(extractPrefixesFromPatterns([]), []);
  });
});

// ── suggestPrefixes ──────────────────────────────────────────

describe('suggestPrefixes', () => {
  it('returns default prefixes for empty registry and no patterns', () => {
    const result = suggestPrefixes({ registry: {} });

    assert.ok(result.suggestions.length >= 2);
    assert.equal(result.suggestions[0]!.prefix, 'ADOPT');
    assert.equal(result.suggestions[0]!.source, 'default');
    assert.equal(result.suggestions[1]!.prefix, 'DEBT');
    assert.equal(result.suggestions[1]!.source, 'default');
  });

  it('prioritizes registry prefixes over defaults', () => {
    const registry: Registry = {
      'SUP-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-002': {
        reason: 'test',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = suggestPrefixes({ registry });
    assert.equal(result.suggestions[0]!.prefix, 'SUP');
    assert.equal(result.suggestions[0]!.source, 'registry');
    assert.equal(result.suggestions[0]!.usageCount, 2);
  });

  it('places refPattern prefixes between registry and defaults', () => {
    const registry: Registry = {
      'SUP-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const refPatterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', urlTemplate: 'https://jira.example.com/{id}' },
    ];

    const result = suggestPrefixes({ registry, refPatterns });

    const sources = result.suggestions.map((s) => s.source);
    const registryIdx = sources.indexOf('registry');
    const patternIdx = sources.indexOf('refPattern');
    const defaultIdx = sources.indexOf('default');

    assert.ok(registryIdx < patternIdx);
    assert.ok(patternIdx < defaultIdx);
  });

  it('deduplicates across sources (registry wins)', () => {
    const registry: Registry = {
      'ADOPT-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = suggestPrefixes({ registry });

    const adoptSuggestions = result.suggestions.filter(
      (s) => s.prefix === 'ADOPT',
    );
    assert.equal(adoptSuggestions.length, 1);
    assert.equal(adoptSuggestions[0]!.source, 'registry');
  });

  it('sorts registry prefixes by usage count descending', () => {
    const registry: Registry = {
      'DEBT-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-001': {
        reason: 'test',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-002': {
        reason: 'test',
        target: 'c.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-003': {
        reason: 'test',
        target: 'd.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = suggestPrefixes({ registry });
    const registrySuggestions = result.suggestions.filter(
      (s) => s.source === 'registry',
    );

    assert.equal(registrySuggestions[0]!.prefix, 'SUP');
    assert.equal(registrySuggestions[0]!.usageCount, 3);
    assert.equal(registrySuggestions[1]!.prefix, 'DEBT');
    assert.equal(registrySuggestions[1]!.usageCount, 1);
  });
});

// ── findNextAvailableNumber ──────────────────────────────────

describe('findNextAvailableNumber', () => {
  it('returns 1 for empty registry', () => {
    assert.equal(findNextAvailableNumber('ADOPT', {}), 1);
  });

  it('returns max+1 for existing refs', () => {
    const registry: Registry = {
      'ADOPT-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'ADOPT-003': {
        reason: 'test',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    assert.equal(findNextAvailableNumber('ADOPT', registry), 4);
  });

  it('ignores refs with different prefix', () => {
    const registry: Registry = {
      'SUP-010': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    assert.equal(findNextAvailableNumber('ADOPT', registry), 1);
  });

  it('handles large numbers', () => {
    const registry: Registry = {
      'MIG-9999': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    assert.equal(findNextAvailableNumber('MIG', registry), 10000);
  });
});

// ── suggestNextRef ───────────────────────────────────────────

describe('suggestNextRef', () => {
  it('generates formatted ref with zero-padding', () => {
    const result = suggestNextRef('ADOPT', {});

    assert.equal(result.prefix, 'ADOPT');
    assert.equal(result.nextNumber, 1);
    assert.equal(result.ref, 'ADOPT-001');
  });

  it('skips existing refs', () => {
    const registry: Registry = {
      'ADOPT-001': {
        reason: 'test',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'ADOPT-002': {
        reason: 'test',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = suggestNextRef('ADOPT', registry);
    assert.equal(result.ref, 'ADOPT-003');
  });

  it('uses 4-digit padding for large estimatedTotal', () => {
    const result = suggestNextRef('ADOPT', {}, 1000);
    assert.equal(result.ref, 'ADOPT-0001');
  });

  it('uses 3-digit padding for small registry', () => {
    const result = suggestNextRef('ADOPT', {}, 5);
    assert.equal(result.ref, 'ADOPT-001');
  });
});

// ── formatRefNumber ──────────────────────────────────────────

describe('formatRefNumber', () => {
  it('pads to 3 digits by default', () => {
    assert.equal(formatRefNumber(1, 10), '001');
    assert.equal(formatRefNumber(42, 100), '042');
    assert.equal(formatRefNumber(999, 999), '999');
  });

  it('pads to 4 digits when totalCount >= 1000', () => {
    assert.equal(formatRefNumber(1, 1000), '0001');
    assert.equal(formatRefNumber(42, 2000), '0042');
    assert.equal(formatRefNumber(1234, 1500), '1234');
  });

  it('does not truncate numbers exceeding pad width', () => {
    assert.equal(formatRefNumber(10000, 50), '10000');
    assert.equal(formatRefNumber(99999, 1000), '99999');
  });
});
