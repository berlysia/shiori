import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import type { FileInput } from '../src/core/providers/AnnotationProvider.ts';

const provider = new CommentProvider();

function makeInput(content: string, path = 'test.ts'): FileInput {
  return { path, content };
}

function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8');
}

describe('CommentProvider', () => {
  describe('Path A: lint directive + shiori:', () => {
    it('detects stylelint-disable-next-line with shiori', () => {
      const input = makeInput(
        '/* stylelint-disable-next-line plugin/baseline -- shiori: ref=SUP-1234 kind=compat expires=2026-06-01 */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, 'plugin/baseline');
      assert.equal(records[0]!.expires, '2026-06-01');
      assert.equal(records[0]!.location.file, 'test.css');
      assert.equal(records[0]!.location.line, 1);
    });

    it('detects stylelint-disable-line with shiori', () => {
      const input = makeInput(
        '.foo { color: red; } /* stylelint-disable-line color-named -- shiori: ref=SUP-5678 kind=waive */',
        'test.css',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-5678');
      assert.equal(records[0]!.rule, 'color-named');
    });

    it('detects eslint-disable-next-line with shiori and expires', () => {
      const input = makeInput(
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: ref=SUP-9999 kind=waive expires=2026-12-31',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-9999');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.expires, '2026-12-31');
    });

    it('detects eslint-disable-line with shiori', () => {
      const input = makeInput(
        'const x = 1; // eslint-disable-line @typescript-eslint/no-explicit-any -- shiori: ref=SUP-0001 kind=waive',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-0001');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.expires, undefined);
    });

    it('detects lint directive with bare ref shorthand', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori:SUP-1234',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, 'no-console');
    });
  });

  describe('multi-rule fan-out', () => {
    it('splits comma-separated rules into separate annotations', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console, no-debugger -- shiori: ref=SUP-MULTI kind=waive',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 2);
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.ref, 'SUP-MULTI');
      assert.equal(records[1]!.ref, 'SUP-MULTI');
    });
  });

  describe('Path B: standalone shiori:', () => {
    it('detects standalone shiori comment (line)', () => {
      const input = makeInput('// shiori: ref=ADR:0007 kind=design');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
    });

    it('detects bare ref shorthand (line)', () => {
      const input = makeInput('// shiori:SUP-1234');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, undefined);
    });

    it('detects bare ref shorthand with namespace (line)', () => {
      const input = makeInput('// shiori:JIRA:PROJ-123');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'JIRA:PROJ-123');
      assert.equal(records[0]!.rule, undefined);
    });

    it('detects bare ref shorthand (block)', () => {
      const input = makeInput('/* shiori:ADR:0007 */');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
    });

    it('detects standalone shiori comment (block)', () => {
      const input = makeInput('/* shiori: ref=ADR:0007 kind=design */');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
    });

    it('detects standalone shiori in multi-line block comment', () => {
      const input = makeInput('/*\n * shiori: ref=ADR:0007 kind=design\n */');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.location.line, 1);
    });
  });

  describe('Path C: lint directive without shiori:', () => {
    it('produces empty ref when shiori: is absent', () => {
      const input = makeInput('// eslint-disable-next-line no-console');
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.rule, 'no-console');
    });

    it('produces empty ref for directive with -- but no shiori:', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- some reason',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.rule, 'no-console');
    });
  });

  describe('Path D: regular comments', () => {
    it('ignores regular comments', () => {
      const input = makeInput(
        '// This is a regular comment\n/* Just a comment */',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 0);
    });
  });

  describe('edge cases', () => {
    it('produces undefined rule when no rules specified in directive', () => {
      const input = makeInput(
        '// eslint-disable-next-line -- shiori: ref=SUP-NORULE kind=waive',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-NORULE');
      assert.equal(records[0]!.rule, undefined);
    });

    it('handles quoted reason', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1 reason="needed for debugging"',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1');
      assert.equal(records[0]!.reason, 'needed for debugging');
    });

    it('handles expires with YYYY-MM format', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1 expires=2026-06',
      );
      const records = provider.scan(input);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.expires, '2026-06');
    });
  });

  describe('fixture files', () => {
    it('parses sample.css correctly', () => {
      const content = loadFixture('sample.css');
      const records = provider.scan({ path: 'sample.css', content });
      assert.equal(records.length, 2);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.location.line, 1);
      assert.equal(records[1]!.ref, 'SUP-5678');
      assert.equal(records[1]!.location.line, 4);
    });

    it('parses sample.ts correctly', () => {
      const content = loadFixture('sample.ts');
      const records = provider.scan({ path: 'sample.ts', content });
      assert.equal(records.length, 2);
      assert.equal(records[0]!.ref, 'SUP-9999');
      assert.equal(records[0]!.location.line, 1);
      assert.equal(records[1]!.ref, 'SUP-0001');
      assert.equal(records[1]!.location.line, 4);
    });

    it('parses edge-cases.ts correctly', () => {
      const content = loadFixture('edge-cases.ts');
      const records = provider.scan({ path: 'edge-cases.ts', content });
      // Line 1: multi-rule (2 records), Line 4: no shiori (1 malformed), Line 7: no rule (1)
      // Lines 9-10: regular comments (0)
      assert.equal(records.length, 4);

      // Multi-rule
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.ref, 'SUP-MULTI');

      // No shiori → malformed
      assert.equal(records[2]!.ref, '');
      assert.equal(records[2]!.rule, 'no-console');

      // No rule
      assert.equal(records[3]!.ref, 'SUP-NORULE');
      assert.equal(records[3]!.rule, undefined);
    });

    it('parses multi-kind.ts correctly', () => {
      const content = loadFixture('multi-kind.ts');
      const records = provider.scan({ path: 'multi-kind.ts', content });
      assert.equal(records.length, 4);

      assert.equal(records[0]!.ref, 'NOTE-1');
      assert.equal(records[0]!.rule, 'no-console');

      assert.equal(records[1]!.ref, 'MIG-1');
      assert.equal(records[1]!.rule, 'no-var');
      assert.equal(records[1]!.expires, '2026-12-31');

      assert.equal(records[2]!.ref, 'RISK-1');
      assert.equal(records[2]!.rule, '@typescript-eslint/no-explicit-any');

      assert.equal(records[3]!.ref, 'SUP-VERB');
      assert.equal(records[3]!.rule, 'no-debugger');
    });
  });
});
