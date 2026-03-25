import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatResolveOutput,
  type ResolveJsonOutput,
} from '../src/formatters/resolve-formatter.ts';
import type { BulkResolveResult } from '../src/commands/resolve.ts';

function makeBulkResult(
  overrides: Partial<BulkResolveResult> = {},
): BulkResolveResult {
  return {
    perRef: [],
    allActions: [],
    allRegistryRemovals: [],
    totalFilesAffected: 0,
    allSkipped: [],
    ...overrides,
  };
}

describe('formatResolveOutput', () => {
  describe('text format', () => {
    it('returns textOutput as-is', () => {
      const result = formatResolveOutput({
        format: 'text',
        bulkResult: makeBulkResult(),
        applied: false,
        textOutput: 'some preview text',
      });
      assert.equal(result, 'some preview text');
    });
  });

  describe('json format', () => {
    it('returns valid JSON with meta + data envelope', () => {
      const bulkResult = makeBulkResult({
        perRef: [
          {
            ref: 'SUP-1234',
            result: {
              actions: [
                {
                  ref: 'SUP-1234',
                  file: 'src/foo.ts',
                  line: 10,
                  type: 'remove-annotation',
                  originalLine:
                    '// eslint-disable-next-line no-console -- shiori: SUP-1234',
                  modifiedLine: '// eslint-disable-next-line no-console',
                },
              ],
              registryRemovals: ['SUP-1234'],
              filesAffected: 1,
              skipped: [],
            },
          },
          {
            ref: 'SUP-5678',
            result: {
              actions: [
                {
                  ref: 'SUP-5678',
                  file: 'src/bar.ts',
                  line: 5,
                  type: 'remove-line',
                  originalLine: '// shiori: SUP-5678',
                  modifiedLine: null,
                },
              ],
              registryRemovals: ['SUP-5678'],
              filesAffected: 1,
              skipped: [
                {
                  file: 'src/baz.ts',
                  line: 3,
                  reason: 'stale',
                },
              ],
            },
          },
        ],
        allActions: [
          {
            ref: 'SUP-1234',
            file: 'src/foo.ts',
            line: 10,
            type: 'remove-annotation',
            originalLine:
              '// eslint-disable-next-line no-console -- shiori: SUP-1234',
            modifiedLine: '// eslint-disable-next-line no-console',
          },
          {
            ref: 'SUP-5678',
            file: 'src/bar.ts',
            line: 5,
            type: 'remove-line',
            originalLine: '// shiori: SUP-5678',
            modifiedLine: null,
          },
        ],
        allRegistryRemovals: ['SUP-1234', 'SUP-5678'],
        totalFilesAffected: 2,
        allSkipped: [{ file: 'src/baz.ts', line: 3, reason: 'stale' }],
      });

      const output = formatResolveOutput({
        format: 'json',
        bulkResult,
        applied: false,
        textOutput: '',
      });

      const parsed: ResolveJsonOutput = JSON.parse(output);

      // meta fields
      assert.equal(parsed.meta.command, 'resolve');
      assert.equal(parsed.meta.schemaVersion, 1);
      assert.equal(parsed.meta.mode, 'closed');
      assert.equal(parsed.meta.applied, false);
      assert.ok(parsed.meta.timestamp);
      assert.ok(parsed.meta.version);

      // data.refs
      assert.equal(parsed.data.refs.length, 2);
      assert.deepEqual(parsed.data.refs[0], {
        ref: 'SUP-1234',
        actions: 1,
        filesAffected: 1,
        registryRemoval: true,
        skipped: 0,
      });
      assert.deepEqual(parsed.data.refs[1], {
        ref: 'SUP-5678',
        actions: 1,
        filesAffected: 1,
        registryRemoval: true,
        skipped: 1,
      });

      // data.summary
      assert.deepEqual(parsed.data.summary, {
        totalRefs: 2,
        totalActions: 2,
        totalFilesAffected: 2,
        totalRegistryRemovals: 2,
        totalSkipped: 1,
      });
    });

    it('sets applied=true when apply mode', () => {
      const output = formatResolveOutput({
        format: 'json',
        bulkResult: makeBulkResult(),
        applied: true,
        textOutput: '',
      });

      const parsed: ResolveJsonOutput = JSON.parse(output);
      assert.equal(parsed.meta.applied, true);
    });

    it('handles empty bulk result', () => {
      const output = formatResolveOutput({
        format: 'json',
        bulkResult: makeBulkResult(),
        applied: false,
        textOutput: '',
      });

      const parsed: ResolveJsonOutput = JSON.parse(output);
      assert.equal(parsed.data.refs.length, 0);
      assert.deepEqual(parsed.data.summary, {
        totalRefs: 0,
        totalActions: 0,
        totalFilesAffected: 0,
        totalRegistryRemovals: 0,
        totalSkipped: 0,
      });
    });

    it('produces valid ISO 8601 timestamp', () => {
      const output = formatResolveOutput({
        format: 'json',
        bulkResult: makeBulkResult(),
        applied: false,
        textOutput: '',
      });

      const parsed: ResolveJsonOutput = JSON.parse(output);
      // Verify timestamp is present and valid ISO 8601
      assert.ok(parsed.meta.timestamp, 'timestamp should be present');
      const date = new Date(parsed.meta.timestamp);
      assert.ok(!isNaN(date.getTime()), 'timestamp should be valid ISO 8601');
    });
  });
});
