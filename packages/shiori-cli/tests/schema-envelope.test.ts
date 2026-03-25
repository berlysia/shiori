import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapOutput,
  wrapOutputJson,
  type CommandOutput,
} from '../src/core/schema-envelope.ts';
import { VERSION } from '../src/core/version.ts';

describe('schema-envelope (ADR 028)', () => {
  describe('wrapOutput', () => {
    it('wraps data with meta envelope', () => {
      const data = { count: 42 };
      const result = wrapOutput(data, {
        command: 'fix',
        schemaVersion: 1,
      });

      assert.equal(result.meta.version, VERSION);
      assert.equal(result.meta.schemaVersion, 1);
      assert.equal(result.meta.command, 'fix');
      assert.equal(result.meta.timestamp, undefined);
      assert.deepEqual(result.data, { count: 42 });
    });

    it('includes timestamp when requested', () => {
      const before = new Date();
      const result = wrapOutput(
        { value: 'test' },
        {
          command: 'resolve',
          schemaVersion: 1,
          includeTimestamp: true,
        },
      );
      const after = new Date();

      assert.ok(result.meta.timestamp);
      const ts = new Date(result.meta.timestamp);
      assert.ok(!isNaN(ts.getTime()), 'timestamp should be valid ISO 8601');
      assert.ok(ts >= before && ts <= after, 'timestamp should be current');
    });

    it('omits timestamp by default', () => {
      const result = wrapOutput('hello', {
        command: 'test',
        schemaVersion: 1,
      });

      assert.equal(result.meta.timestamp, undefined);
    });

    it('preserves complex data structures', () => {
      const data = {
        items: [{ ref: 'SUP-1234', count: 3 }],
        nested: { deep: { value: true } },
      };
      const result = wrapOutput(data, {
        command: 'report',
        schemaVersion: 2,
      });

      assert.deepEqual(result.data, data);
      assert.equal(result.meta.schemaVersion, 2);
    });

    it('returns correctly typed CommandOutput', () => {
      interface TestData {
        name: string;
        score: number;
      }
      const data: TestData = { name: 'test', score: 100 };
      const result: CommandOutput<TestData> = wrapOutput(data, {
        command: 'test',
        schemaVersion: 1,
      });

      // Type-level check: result.data should be TestData
      assert.equal(result.data.name, 'test');
      assert.equal(result.data.score, 100);
    });
  });

  describe('wrapOutputJson', () => {
    it('returns valid JSON string with envelope', () => {
      const json = wrapOutputJson(
        { refs: ['SUP-1'] },
        { command: 'fix', schemaVersion: 1 },
      );

      const parsed = JSON.parse(json);
      assert.equal(parsed.meta.command, 'fix');
      assert.equal(parsed.meta.schemaVersion, 1);
      assert.equal(parsed.meta.version, VERSION);
      assert.deepEqual(parsed.data, { refs: ['SUP-1'] });
    });

    it('produces pretty-printed JSON (2-space indent)', () => {
      const json = wrapOutputJson(
        { a: 1 },
        { command: 'test', schemaVersion: 1 },
      );

      // Pretty-printed JSON has newlines and indentation
      assert.ok(json.includes('\n'));
      assert.ok(json.includes('  '));
    });

    it('round-trips through JSON.parse correctly', () => {
      const original = { items: [1, 2, 3], nested: { ok: true } };
      const json = wrapOutputJson(original, {
        command: 'summary',
        schemaVersion: 1,
      });

      const parsed = JSON.parse(json);
      assert.deepEqual(parsed.data, original);
    });
  });
});
