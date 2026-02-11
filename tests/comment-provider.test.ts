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
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, 'plugin/baseline');
      assert.equal(records[0]!.expires, '2026-06-01');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[0]!.location.file, 'test.css');
      assert.equal(records[0]!.location.line, 1);
    });

    it('detects stylelint-disable-line with shiori', () => {
      const input = makeInput(
        '.foo { color: red; } /* stylelint-disable-line color-named -- shiori: ref=SUP-5678 kind=waive */',
        'test.css',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-5678');
      assert.equal(records[0]!.rule, 'color-named');
      assert.equal(records[0]!.tagged, true);
    });

    it('detects eslint-disable-next-line with shiori and expires', () => {
      const input = makeInput(
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: ref=SUP-9999 kind=waive expires=2026-12-31',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-9999');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.expires, '2026-12-31');
      assert.equal(records[0]!.tagged, true);
    });

    it('detects eslint-disable-line with shiori', () => {
      const input = makeInput(
        'const x = 1; // eslint-disable-line @typescript-eslint/no-explicit-any -- shiori: ref=SUP-0001 kind=waive',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-0001');
      assert.equal(records[0]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[0]!.expires, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects lint directive with bare ref shorthand', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori:SUP-1234',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[0]!.tagged, true);
    });
  });

  describe('multi-rule fan-out', () => {
    it('splits comma-separated rules into separate annotations', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console, no-debugger -- shiori: ref=SUP-MULTI kind=waive',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 2);
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.ref, 'SUP-MULTI');
      assert.equal(records[1]!.ref, 'SUP-MULTI');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[1]!.tagged, true);
    });
  });

  describe('Path B: standalone shiori:', () => {
    it('detects standalone shiori comment (line)', () => {
      const input = makeInput('// shiori: ref=ADR:0007 kind=design');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects bare ref shorthand (line)', () => {
      const input = makeInput('// shiori:SUP-1234');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects bare ref shorthand with namespace (line)', () => {
      const input = makeInput('// shiori:JIRA:PROJ-123');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'JIRA:PROJ-123');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects bare ref shorthand (block)', () => {
      const input = makeInput('/* shiori:ADR:0007 */');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects standalone shiori comment (block)', () => {
      const input = makeInput('/* shiori: ref=ADR:0007 kind=design */');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects standalone shiori in multi-line block comment', () => {
      const input = makeInput('/*\n * shiori: ref=ADR:0007 kind=design\n */');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[0]!.location.line, 1);
    });
  });

  describe('Path C: lint directive without shiori:', () => {
    it('does not produce annotation when shiori: is absent', () => {
      const input = makeInput('// eslint-disable-next-line no-console');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 0);
    });

    it('does not produce annotation for directive with -- but no shiori:', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- some reason',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 0);
    });
  });

  describe('shiori:ignore', () => {
    it('detects shiori:ignore on lint directive', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori:ignore',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[0]!.ignored, true);
      assert.equal(records[0]!.syntaxErrors, undefined);
    });

    it('detects shiori:ignore with multiple rules', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console, no-debugger -- shiori:ignore',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 2);
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[0]!.ignored, true);
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[1]!.ignored, true);
    });

    it('reports syntax-error when ignore is combined with ref', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori:ignore ref=SUP-1234',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ignored, false);
      assert.ok(records[0]!.syntaxErrors);
      assert.ok(records[0]!.syntaxErrors!.length > 0);
    });

    it('reports syntax-error when ref precedes ignore', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1234 ignore',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      // This goes through normal Path A parse since shiori:ignore regex does not match "shiori: ref=SUP-1234 ignore"
      // The word "ignore" just becomes a bare token that the parser ignores
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.ignored, false);
    });

    it('treats standalone shiori:ignore as bare ref shorthand', () => {
      const input = makeInput('// shiori:ignore');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      // Path B: bare ref shorthand parses "ignore" as ref
      assert.equal(records[0]!.ref, 'ignore');
      assert.equal(records[0]!.ignored, false);
      assert.equal(records[0]!.tagged, true);
    });
  });

  describe('Path D: regular comments', () => {
    it('ignores regular comments', () => {
      const input = makeInput(
        '// This is a regular comment\n/* Just a comment */',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 0);
    });
  });

  describe('candidate detection', () => {
    describe('lint-disable candidates (Path C)', () => {
      it('produces lint-disable candidate for directive without shiori:', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'lint-disable');
        assert.equal(result.candidates[0]!.rule, 'no-console');
        assert.equal(result.candidates[0]!.location.file, 'test.ts');
        assert.equal(result.candidates[0]!.location.line, 1);
      });

      it('produces candidates for multi-rule directive without shiori:', () => {
        const input = makeInput(
          '// eslint-disable-next-line no-console, no-debugger',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 2);
        assert.equal(result.candidates[0]!.rule, 'no-console');
        assert.equal(result.candidates[1]!.rule, 'no-debugger');
      });

      it('produces candidate for directive with comment but no shiori:', () => {
        const input = makeInput(
          '// eslint-disable-next-line no-console -- some reason',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'lint-disable');
        assert.equal(result.candidates[0]!.rule, 'no-console');
      });

      it('produces candidate for stylelint directive without shiori:', () => {
        const input = makeInput(
          '/* stylelint-disable-next-line color-named */',
          'test.css',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'lint-disable');
        assert.equal(result.candidates[0]!.rule, 'color-named');
      });

      it('does not produce candidate when lint-disable pattern is disabled', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': false,
            todo: false,
            fixme: false,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 0);
      });

      it('does not produce candidate when directive has shiori:', () => {
        const input = makeInput(
          '// eslint-disable-next-line no-console -- shiori: ref=SUP-1234',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.candidates.length, 0);
      });
    });

    describe('TODO/FIXME/HACK/XXX candidates (Path D)', () => {
      it('detects TODO keyword', () => {
        const input = makeInput('// TODO: fix this later');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: true,
            fixme: false,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'todo');
        assert.equal(result.candidates[0]!.text, 'fix this later');
        assert.equal(result.candidates[0]!.location.line, 1);
      });

      it('detects FIXME keyword', () => {
        const input = makeInput('// FIXME broken edge case');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: false,
            fixme: true,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'fixme');
        assert.equal(result.candidates[0]!.text, 'broken edge case');
      });

      it('detects HACK keyword', () => {
        const input = makeInput('// HACK workaround for bug');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: false,
            fixme: false,
            hack: true,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'hack');
        assert.equal(result.candidates[0]!.text, 'workaround for bug');
      });

      it('detects XXX keyword', () => {
        const input = makeInput('// XXX needs review');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: false,
            fixme: false,
            hack: false,
            xxx: true,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'xxx');
        assert.equal(result.candidates[0]!.text, 'needs review');
      });

      it('ignores TODO when todo pattern is disabled (default)', () => {
        const input = makeInput('// TODO: fix this later');
        const result = provider.scan(input);
        assert.equal(result.candidates.length, 0);
      });

      it('ignores lowercase todo', () => {
        const input = makeInput('// todo: fix this');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: true,
            fixme: false,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 0);
      });

      it('captures text after TODO without colon', () => {
        const input = makeInput('// TODO fix this');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: true,
            fixme: false,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.text, 'fix this');
      });

      it('returns undefined text for TODO with no description', () => {
        const input = makeInput('// TODO');
        const result = provider.scan(input, {
          candidatePatterns: {
            'lint-disable': true,
            todo: true,
            fixme: false,
            hack: false,
            xxx: false,
          },
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.text, undefined);
      });
    });
  });

  describe('edge cases', () => {
    it('produces undefined rule when no rules specified in directive', () => {
      const input = makeInput(
        '// eslint-disable-next-line -- shiori: ref=SUP-NORULE kind=waive',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-NORULE');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('handles quoted reason', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1 reason="needed for debugging"',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1');
      assert.equal(records[0]!.reason, 'needed for debugging');
      assert.equal(records[0]!.tagged, true);
    });

    it('handles expires with YYYY-MM format', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1 expires=2026-06',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.expires, '2026-06');
      assert.equal(records[0]!.tagged, true);
    });
  });

  describe('fixture files', () => {
    it('parses sample.css correctly', () => {
      const content = loadFixture('sample.css');
      const records = provider.scan({
        path: 'sample.css',
        content,
      }).annotations;
      assert.equal(records.length, 2);
      assert.equal(records[0]!.ref, 'SUP-1234');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[0]!.location.line, 1);
      assert.equal(records[1]!.ref, 'SUP-5678');
      assert.equal(records[1]!.tagged, true);
      assert.equal(records[1]!.location.line, 8);
    });

    it('parses sample.ts correctly', () => {
      const content = loadFixture('sample.ts');
      const records = provider.scan({ path: 'sample.ts', content }).annotations;
      assert.equal(records.length, 2);
      assert.equal(records[0]!.ref, 'SUP-9999');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[0]!.location.line, 1);
      assert.equal(records[1]!.ref, 'SUP-0001');
      assert.equal(records[1]!.tagged, true);
      assert.equal(records[1]!.location.line, 4);
    });

    it('parses edge-cases.ts correctly', () => {
      const content = loadFixture('edge-cases.ts');
      const records = provider.scan({
        path: 'edge-cases.ts',
        content,
      }).annotations;
      // Line 1: multi-rule (2 records), Line 4: no shiori (skipped — Path C), Line 7: no rule (1)
      // Lines 9-10: regular comments (0)
      assert.equal(records.length, 3);

      // Multi-rule
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[1]!.rule, 'no-debugger');
      assert.equal(records[0]!.ref, 'SUP-MULTI');
      assert.equal(records[0]!.tagged, true);
      assert.equal(records[1]!.tagged, true);

      // No rule (but has shiori:)
      assert.equal(records[2]!.ref, 'SUP-NORULE');
      assert.equal(records[2]!.rule, undefined);
      assert.equal(records[2]!.tagged, true);
    });

    it('parses multi-kind.ts correctly', () => {
      const content = loadFixture('multi-kind.ts');
      const records = provider.scan({
        path: 'multi-kind.ts',
        content,
      }).annotations;
      assert.equal(records.length, 4);

      assert.equal(records[0]!.ref, 'NOTE-1');
      assert.equal(records[0]!.rule, 'no-console');
      assert.equal(records[0]!.tagged, true);

      assert.equal(records[1]!.ref, 'MIG-1');
      assert.equal(records[1]!.rule, 'no-var');
      assert.equal(records[1]!.expires, '2026-12-31');
      assert.equal(records[1]!.tagged, true);

      assert.equal(records[2]!.ref, 'RISK-1');
      assert.equal(records[2]!.rule, '@typescript-eslint/no-explicit-any');
      assert.equal(records[2]!.tagged, true);

      assert.equal(records[3]!.ref, 'SUP-VERB');
      assert.equal(records[3]!.rule, 'no-debugger');
      assert.equal(records[3]!.tagged, true);
    });
  });
});
