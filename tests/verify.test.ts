import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Registry, RegistryEntry, AnnotationRecord } from '../src/core/types.ts';
import { verify, formatVerifyResultAsMarkdown } from '../src/commands/verify.ts';

function makeRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: 'TEST-001',
    verb: 'waive',
    tool: 'eslint',
    subject: 'no-console',
    file: 'test.ts',
    line: 1,
    source: 'comment',
    raw: '// eslint-disable-next-line no-console -- waive(TEST-001)',
    meta: {},
    provider: 'CommentProvider',
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
    verb: undefined,
    ...overrides,
  };
}

const referenceDate = new Date('2026-02-11T00:00:00Z');

describe('verify', () => {
  describe('missing-in-registry', () => {
    it('detects IDs in source but not in registry', () => {
      const records = [makeRecord({ id: 'SUP-NEW' })];
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
      assert.equal(result.issues[0]!.id, 'SUP-NEW');
      assert.equal(result.issues[0]!.severity, 'error');
    });

    it('deduplicates missing IDs', () => {
      const records = [
        makeRecord({ id: 'SUP-NEW', file: 'a.ts', line: 1 }),
        makeRecord({ id: 'SUP-NEW', file: 'b.ts', line: 2 }),
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
    it('detects IDs in registry but not in source', () => {
      const records: AnnotationRecord[] = [];
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
      assert.equal(result.issues[0]!.id, 'SUP-OLD');
      assert.equal(result.issues[0]!.severity, 'warning');
    });
  });

  describe('expired', () => {
    it('detects expired registry entries', () => {
      const records = [makeRecord({ id: 'SUP-EXP' })];
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
      const records = [makeRecord({ id: 'SUP-FUT' })];
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
  });

  describe('malformed', () => {
    it('detects records with empty id', () => {
      const records = [makeRecord({ id: '' })];
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
      const records = [makeRecord({ id: 'SUP-OK' })];
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
      const records = [makeRecord({ id: 'SUP-MISS' })];
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
        makeRecord({ id: 'SUP-MISS' }),
        makeRecord({ id: '' }),
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
      const records = [makeRecord({ id: 'SUP-MISS' })];
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
      const records = [makeRecord({ id: 'SUP-OK' })];
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
