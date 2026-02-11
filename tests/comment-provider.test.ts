import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import type { FileInput } from '../src/core/providers/SuppressionProvider.ts';

const provider = new CommentProvider();

function makeInput(content: string, path = 'test.ts'): FileInput {
  return { path, content };
}

function loadFixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf-8',
  );
}

describe('CommentProvider', () => {
  describe('stylelint detection', () => {
    it('detects stylelint-disable-next-line with waive and expires', () => {
      const input = makeInput(
        '/* stylelint-disable-next-line plugin/baseline -- waive(SUP-1234) expires=2026-06-01 */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, 'SUP-1234');
      assert.equal(records[0]!.linter, 'stylelint');
      assert.equal(records[0]!.rule, 'plugin/baseline');
      assert.equal(records[0]!.meta.expires, '2026-06-01');
      assert.equal(records[0]!.source, 'comment');
      assert.equal(records[0]!.provider, 'CommentProvider');
      assert.equal(records[0]!.line, 1);
    });

    it('detects stylelint-disable-line', () => {
      const input = makeInput(
        '.foo { color: red; } /* stylelint-disable-line color-named -- waive(SUP-5678) */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, 'SUP-5678');
      assert.equal(records[0]!.linter, 'stylelint');
      assert.equal(records[0]!.rule, 'color-named');
    });
  });

  describe('eslint detection', () => {
    it('detects eslint-disable-next-line with waive and expires', () => {
      const input = makeInput(
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- waive(SUP-9999) expires=2026-12-31',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, 'SUP-9999');
      assert.equal(records[0]!.linter, 'eslint');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.meta.expires, '2026-12-31');
    });

    it('detects eslint-disable-line', () => {
      const input = makeInput(
        'const x = 1; // eslint-disable-line @typescript-eslint/no-explicit-any -- waive(SUP-0001)',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, 'SUP-0001');
      assert.equal(records[0]!.linter, 'eslint');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.meta.expires, undefined);
    });
  });

  describe('multiple rules', () => {
    it('splits comma-separated rules into separate records', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console, no-debugger -- waive(SUP-MULTI)',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 2);
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.id, 'SUP-MULTI');
      assert.equal(records[1]!.id, 'SUP-MULTI');
    });
  });

  describe('edge cases', () => {
    it('produces empty id when waive() is absent', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, '');
      assert.equal(records[0]!.rule, 'no-console');
    });

    it('produces undefined rule when no rules specified', () => {
      const input = makeInput(
        '// eslint-disable-next-line -- waive(SUP-NORULE)',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, 'SUP-NORULE');
      assert.equal(records[0]!.rule, undefined);
    });

    it('ignores regular comments', () => {
      const input = makeInput(
        '// This is a regular comment with waive(FAKE-ID)\n/* Just a comment */',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 0);
    });

    it('handles expires with quotes', () => {
      const input = makeInput(
        '/* stylelint-disable-next-line plugin/x -- waive(A) expires="2026-01-01" */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.meta.expires, '2026-01-01');
    });

    it('handles expires without quotes', () => {
      const input = makeInput(
        '/* stylelint-disable-next-line plugin/y -- waive(B) expires=2026-02-02 */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.meta.expires, '2026-02-02');
    });
  });

  describe('fixture files', () => {
    it('parses sample.css correctly', () => {
      const content = loadFixture('sample.css');
      const records = provider.scan({ path: 'sample.css', content });
      assert.equal(records.length, 2);
      assert.equal(records[0]!.id, 'SUP-1234');
      assert.equal(records[0]!.line, 1);
      assert.equal(records[1]!.id, 'SUP-5678');
      assert.equal(records[1]!.line, 4);
    });

    it('parses sample.ts correctly', () => {
      const content = loadFixture('sample.ts');
      const records = provider.scan({ path: 'sample.ts', content });
      assert.equal(records.length, 2);
      assert.equal(records[0]!.id, 'SUP-9999');
      assert.equal(records[0]!.line, 1);
      assert.equal(records[1]!.id, 'SUP-0001');
      assert.equal(records[1]!.line, 4);
    });

    it('parses edge-cases.ts correctly', () => {
      const content = loadFixture('edge-cases.ts');
      const records = provider.scan({ path: 'edge-cases.ts', content });
      // Line 1: multi-rule (2 records), Line 4: no waive (1), Line 7: no rule (1)
      // Lines 9-10: regular comments (0)
      assert.equal(records.length, 4);

      // Multi-rule
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.id, 'SUP-MULTI');

      // No waive
      assert.equal(records[2]!.id, '');
      assert.equal(records[2]!.rule, 'no-console');

      // No rule
      assert.equal(records[3]!.id, 'SUP-NORULE');
      assert.equal(records[3]!.rule, undefined);
    });
  });
});
