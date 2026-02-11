import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Registry, RegistryEntry, ShioriAnnotation } from '../src/core/types.ts';
import { verify, formatVerifyResultAsMarkdown } from '../src/commands/verify.ts';

function makeAnnotation(overrides: Partial<ShioriAnnotation> = {}): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    kind: 'waive',
    rule: 'no-console',
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'all',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

const referenceDate = new Date('2026-02-11T00:00:00Z');

describe('verify', () => {
  describe('missing-in-registry', () => {
    it('detects refs in source but not in registry', () => {
      const records = [makeAnnotation({ ref: 'SUP-NEW' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'missing-in-registry');
      assert.equal(result.issues[0]!.ref, 'SUP-NEW');
      assert.equal(result.issues[0]!.severity, 'error');
    });

    it('deduplicates missing refs', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-NEW', location: { file: 'a.ts', line: 1 } }),
        makeAnnotation({ ref: 'SUP-NEW', location: { file: 'b.ts', line: 2 } }),
      ];
      const result = verify({
        records,
        registry: {},
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const missing = result.issues.filter((i) => i.type === 'missing-in-registry');
      assert.equal(missing.length, 1);
    });
  });

  describe('unused-in-source', () => {
    it('detects refs in registry but not in source', () => {
      const records: ShioriAnnotation[] = [];
      const registry: Registry = { 'SUP-OLD': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'unused-in-source');
      assert.equal(result.issues[0]!.ref, 'SUP-OLD');
      assert.equal(result.issues[0]!.severity, 'warning');
    });
  });

  describe('expired', () => {
    it('detects expired registry entries', () => {
      const records = [makeAnnotation({ ref: 'SUP-EXP' })];
      const registry: Registry = {
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 1);
      assert.equal(expired[0]!.severity, 'error');
    });

    it('does not flag future expires as expired', () => {
      const records = [makeAnnotation({ ref: 'SUP-FUT' })];
      const registry: Registry = {
        'SUP-FUT': makeRegistryEntry({ expires: '2027-12-31' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 0);
    });

    it('normalizes YYYY-MM expires to end of month', () => {
      const records = [makeAnnotation({ ref: 'SUP-MON' })];
      const registry: Registry = {
        'SUP-MON': makeRegistryEntry({ expires: '2026-02' }),
      };
      // 2026-02-11 should NOT treat 2026-02 as expired (it means end of Feb)
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 0);
    });
  });

  describe('malformed', () => {
    it('detects records with empty ref', () => {
      const records = [makeAnnotation({ ref: '' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['malformed'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'malformed');
      assert.equal(result.issues[0]!.severity, 'error');
      assert.equal(result.issues[0]!.message, 'Annotation without tracking ID');
    });
  });

  describe('no issues', () => {
    it('returns empty issues when everything matches', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = {
        'SUP-OK': makeRegistryEntry({ expires: '2027-12-31' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry', 'expired'],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 0);
      assert.equal(result.summary.total, 0);
    });
  });

  describe('severity control', () => {
    it('applies failOn as error and default as warning', () => {
      const records = [makeAnnotation({ ref: 'SUP-MISS' })];
      const registry: Registry = { 'SUP-UNUSED': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      const missing = result.issues.find((i) => i.type === 'missing-in-registry');
      const unused = result.issues.find((i) => i.type === 'unused-in-source');
      assert.equal(missing?.severity, 'error');
      assert.equal(unused?.severity, 'warning');
    });
  });

  describe('summary', () => {
    it('produces correct summary statistics', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-MISS' }),
        makeAnnotation({ ref: '' }),
      ];
      const registry: Registry = {
        'SUP-UNUSED': makeRegistryEntry(),
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry', 'expired'],
        warnOn: ['unused-in-source', 'malformed'],
        now: referenceDate,
      });
      // SUP-EXP is both unused-in-source and expired
      assert.equal(result.summary.total, 5);
      assert.equal(result.summary.errors, 2);
      assert.equal(result.summary.warnings, 3);
      assert.equal(result.summary.byType['missing-in-registry'], 1);
      assert.equal(result.summary.byType['unused-in-source'], 2);
      assert.equal(result.summary.byType['expired'], 1);
      assert.equal(result.summary.byType['malformed'], 1);
    });
  });

  describe('formatVerifyResultAsMarkdown', () => {
    it('generates markdown with errors and warnings sections', () => {
      const records = [makeAnnotation({ ref: 'SUP-MISS' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      const md = formatVerifyResultAsMarkdown(result);
      assert.ok(md.includes('# Annotation Registry Verification Report'));
      assert.ok(md.includes('## Errors'));
      assert.ok(md.includes('SUP-MISS'));
      assert.ok(md.includes('missing-in-registry'));
    });

    it('shows "No issues found" when clean', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const md = formatVerifyResultAsMarkdown(result);
      assert.ok(md.includes('No issues found'));
    });
  });
});
