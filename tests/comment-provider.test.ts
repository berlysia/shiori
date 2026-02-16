import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import type {
  FileInput,
  CandidatePatternConfig,
  ResolvedCandidatePatterns,
} from '../src/core/providers/AnnotationProvider.ts';
import { resolveCandidatePatterns } from '../src/core/providers/AnnotationProvider.ts';

const provider = new CommentProvider();

function makeInput(content: string, path = 'test.ts'): FileInput {
  return { path, content };
}

function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8');
}

/** Helper to create resolved patterns from user-facing config */
function makePatterns(
  config: CandidatePatternConfig,
): ResolvedCandidatePatterns {
  return resolveCandidatePatterns(config);
}

describe('CommentProvider', () => {
  describe('Path A: lint directive + shiori:', () => {
    it('detects stylelint-disable-next-line with shiori', () => {
      const input = makeInput(
        '/* stylelint-disable-next-line plugin/baseline -- shiori: SUP-1234 kind=compat expires=2026-06-01 */',
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
        '.foo { color: red; } /* stylelint-disable-line color-named -- shiori: SUP-5678 kind=waive */',
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
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: SUP-9999 kind=waive expires=2026-12-31',
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
        'const x = 1; // eslint-disable-line @typescript-eslint/no-explicit-any -- shiori: SUP-0001 kind=waive',
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

    it('detects @ts-ignore with shiori', () => {
      const input = makeInput(
        '// @ts-ignore shiori: SUP-TS01 reason="legacy code"',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-TS01');
      assert.equal(records[0]!.reason, 'legacy code');
      assert.equal(records[0]!.tagged, true);
    });

    it('detects @ts-expect-error with shiori', () => {
      const input = makeInput(
        '// @ts-expect-error shiori: SUP-TS02 expires=2026-06',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-TS02');
      assert.equal(records[0]!.expires, '2026-06');
      assert.equal(records[0]!.tagged, true);
    });
  });

  describe('multi-rule fan-out', () => {
    it('splits comma-separated rules into separate annotations', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console, no-debugger -- shiori: SUP-MULTI kind=waive',
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
      const input = makeInput('// shiori: ADR:0007 kind=design');
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
      const input = makeInput('/* shiori: ADR:0007 kind=design */');
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'ADR:0007');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('detects standalone shiori in multi-line block comment', () => {
      const input = makeInput('/*\n * shiori: ADR:0007 kind=design\n */');
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

    it('treats shiori:ignore with extra fields as simply ignored', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori:ignore SUP-1234',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ignored, true);
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.syntaxErrors, undefined);
    });

    it('reports syntax-error when ref= (invalid key) precedes ignore bare token', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: ref=SUP-1234 ignore',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      // ref= is now an invalid key, "ignore" is an unexpected bare token → 2 errors
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.ignored, false);
      assert.ok(records[0]!.syntaxErrors);
      assert.equal(records[0]!.syntaxErrors!.length, 2);
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

    it('detects shiori:ignore on @ts-ignore', () => {
      const input = makeInput('// @ts-ignore shiori:ignore');
      const records = provider.scan(input, {
        candidatePatterns: makePatterns({
          eslint: true,
          stylelint: true,
          typescript: true,
        }),
      }).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, '');
      assert.equal(records[0]!.ignored, true);
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
    describe('eslint candidates (Path C)', () => {
      it('produces eslint candidate for directive without shiori:', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'eslint');
        assert.equal(result.candidates[0]!.directive, 'disable-next-line');
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
        assert.equal(result.candidates[0]!.pattern, 'eslint');
        assert.equal(result.candidates[0]!.directive, 'disable-next-line');
        assert.equal(result.candidates[0]!.rule, 'no-console');
      });

      it('does not produce candidate when eslint is disabled', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: false,
            stylelint: false,
          }),
        });
        assert.equal(result.candidates.length, 0);
      });

      it('does not produce candidate when specific directive is disabled', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: { 'disable-next-line': false },
            stylelint: true,
          }),
        });
        assert.equal(result.candidates.length, 0);
      });

      it('produces candidate when only disable-line is disabled', () => {
        const input = makeInput('// eslint-disable-next-line no-console');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: { 'disable-line': false },
            stylelint: true,
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'eslint');
        assert.equal(result.candidates[0]!.directive, 'disable-next-line');
      });

      it('does not produce candidate when directive has shiori:', () => {
        const input = makeInput(
          '// eslint-disable-next-line no-console -- shiori: SUP-1234',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.candidates.length, 0);
      });
    });

    describe('stylelint candidates (Path C)', () => {
      it('produces stylelint candidate for directive without shiori:', () => {
        const input = makeInput(
          '/* stylelint-disable-next-line color-named */',
          'test.css',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'stylelint');
        assert.equal(result.candidates[0]!.directive, 'disable-next-line');
        assert.equal(result.candidates[0]!.rule, 'color-named');
      });

      it('does not produce candidate when stylelint is disabled', () => {
        const input = makeInput(
          '/* stylelint-disable-next-line color-named */',
          'test.css',
        );
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: false,
          }),
        });
        assert.equal(result.candidates.length, 0);
      });
    });

    describe('TypeScript directive candidates', () => {
      it('detects @ts-ignore as candidate', () => {
        const input = makeInput('// @ts-ignore');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            typescript: true,
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'typescript');
        assert.equal(result.candidates[0]!.directive, 'ts-ignore');
      });

      it('detects @ts-expect-error as candidate', () => {
        const input = makeInput('// @ts-expect-error');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            typescript: true,
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'typescript');
        assert.equal(result.candidates[0]!.directive, 'ts-expect-error');
      });

      it('does not detect TypeScript directives when typescript is disabled', () => {
        const input = makeInput('// @ts-ignore');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            typescript: false,
          }),
        });
        assert.equal(result.candidates.length, 0);
      });

      it('does not detect TypeScript directives by default (not in default config)', () => {
        const input = makeInput('// @ts-ignore');
        const result = provider.scan(input);
        assert.equal(result.candidates.length, 0);
      });

      it('respects per-directive control for TypeScript', () => {
        const input = makeInput('// @ts-ignore\n// @ts-expect-error');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            typescript: { 'ts-ignore': true, 'ts-expect-error': false },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.directive, 'ts-ignore');
      });
    });

    describe('keyword candidates', () => {
      it('detects TODO keyword', () => {
        const input = makeInput('// TODO: fix this later');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { todo: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'keywords');
        assert.equal(result.candidates[0]!.directive, 'todo');
        assert.equal(result.candidates[0]!.text, 'fix this later');
        assert.equal(result.candidates[0]!.location.line, 1);
      });

      it('detects FIXME keyword', () => {
        const input = makeInput('// FIXME broken edge case');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { fixme: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'keywords');
        assert.equal(result.candidates[0]!.directive, 'fixme');
        assert.equal(result.candidates[0]!.text, 'broken edge case');
      });

      it('detects HACK keyword', () => {
        const input = makeInput('// HACK workaround for bug');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { hack: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'keywords');
        assert.equal(result.candidates[0]!.directive, 'hack');
        assert.equal(result.candidates[0]!.text, 'workaround for bug');
      });

      it('detects XXX keyword', () => {
        const input = makeInput('// XXX needs review');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { xxx: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'keywords');
        assert.equal(result.candidates[0]!.directive, 'xxx');
        assert.equal(result.candidates[0]!.text, 'needs review');
      });

      it('ignores TODO when keywords are disabled (default)', () => {
        const input = makeInput('// TODO: fix this later');
        const result = provider.scan(input);
        assert.equal(result.candidates.length, 0);
      });

      it('ignores lowercase todo', () => {
        const input = makeInput('// todo: fix this');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: true,
          }),
        });
        assert.equal(result.candidates.length, 0);
      });

      it('captures text after TODO without colon', () => {
        const input = makeInput('// TODO fix this');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { todo: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.text, 'fix this');
      });

      it('returns undefined text for TODO with no description', () => {
        const input = makeInput('// TODO');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: { todo: true },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.text, undefined);
      });

      it('detects keywords with boolean shorthand (all enabled)', () => {
        const input = makeInput(
          '// TODO task1\n// FIXME task2\n// HACK task3\n// XXX task4',
        );
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            eslint: true,
            stylelint: true,
            keywords: true,
          }),
        });
        assert.equal(result.candidates.length, 4);
        assert.equal(result.candidates[0]!.directive, 'todo');
        assert.equal(result.candidates[1]!.directive, 'fixme');
        assert.equal(result.candidates[2]!.directive, 'hack');
        assert.equal(result.candidates[3]!.directive, 'xxx');
      });
    });

    describe('custom _matchers', () => {
      it('detects custom tool via _matchers', () => {
        const input = makeInput('// biome-ignore lint/style/useConst: reason');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            biome: {
              _matchers: {
                ignore: {
                  pattern: '\\bbiome-ignore\\s+(.*)',
                  rules: 'single',
                  separator: ':',
                },
              },
              ignore: true,
            },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'biome');
        assert.equal(result.candidates[0]!.directive, 'ignore');
        assert.equal(result.candidates[0]!.rule, 'lint/style/useConst');
      });

      it('detects shiori: in custom tool meta part', () => {
        const input = makeInput(
          '// biome-ignore lint/style/useConst: shiori: SUP-BIOME',
        );
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            biome: {
              _matchers: {
                ignore: {
                  pattern: '\\bbiome-ignore\\s+(.*)',
                  rules: 'single',
                  separator: ':',
                },
              },
              ignore: true,
            },
          }),
        });
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-BIOME');
        assert.equal(result.annotations[0]!.rule, 'lint/style/useConst');
        assert.equal(result.candidates.length, 0);
      });

      it('adds keyword via _matchers', () => {
        const input = makeInput('// NOTE: important detail');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            keywords: {
              _matchers: {
                note: {
                  pattern: '^NOTE\\b:?\\s*(.*)',
                  text: true,
                },
              },
              note: true,
              todo: true,
            },
          }),
        });
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'keywords');
        assert.equal(result.candidates[0]!.directive, 'note');
        assert.equal(result.candidates[0]!.text, 'important detail');
      });

      it('_matchers-added matcher defaults to disabled without explicit true', () => {
        const input = makeInput('// NOTE: important detail');
        const result = provider.scan(input, {
          candidatePatterns: makePatterns({
            keywords: {
              _matchers: {
                note: {
                  pattern: '^NOTE\\b:?\\s*(.*)',
                  text: true,
                },
              },
              todo: true,
              // note not explicitly set → disabled
            },
          }),
        });
        assert.equal(result.candidates.length, 0);
      });
    });
  });

  describe('edge cases', () => {
    it('produces undefined rule when no rules specified in directive', () => {
      const input = makeInput(
        '// eslint-disable-next-line -- shiori: SUP-NORULE kind=waive',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-NORULE');
      assert.equal(records[0]!.rule, undefined);
      assert.equal(records[0]!.tagged, true);
    });

    it('handles quoted reason', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: SUP-1 reason="needed for debugging"',
      );
      const records = provider.scan(input).annotations;
      assert.equal(records.length, 1);
      assert.equal(records[0]!.ref, 'SUP-1');
      assert.equal(records[0]!.reason, 'needed for debugging');
      assert.equal(records[0]!.tagged, true);
    });

    it('handles expires with YYYY-MM format', () => {
      const input = makeInput(
        '// eslint-disable-next-line no-console -- shiori: SUP-1 expires=2026-06',
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

  describe('multi-language comment support (ADR 017)', () => {
    describe('hash-style comments', () => {
      it('detects standalone shiori in Python comment', () => {
        const input = makeInput('# shiori: SUP-001', 'test.py');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-001');
        assert.equal(result.annotations[0]!.rule, undefined);
        assert.equal(result.annotations[0]!.tagged, true);
      });

      it('detects shiori with key=value in Ruby comment', () => {
        const input = makeInput('# shiori: SUP-002 expires=2026-06', 'test.rb');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-002');
        assert.equal(result.annotations[0]!.expires, '2026-06');
      });

      it('detects shiori in Shell comment', () => {
        const input = makeInput('# shiori: SUP-003', 'test.sh');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-003');
      });

      it('detects shiori in YAML comment', () => {
        const input = makeInput('# shiori: ADR:0017', 'config.yaml');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'ADR:0017');
      });

      it('detects shiori in TOML comment', () => {
        const input = makeInput('# shiori: CFG-001', 'config.toml');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'CFG-001');
      });

      it('detects bare ref shorthand in hash comment', () => {
        const input = makeInput('# shiori:SUP-1234', 'test.py');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-1234');
      });

      it('detects draft annotation in hash comment', () => {
        const input = makeInput('# shiori:', 'test.py');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, '');
      });

      it('detects eslint candidate in hash comment when eslint pattern enabled', () => {
        const input = makeInput(
          '# eslint-disable-next-line no-console',
          'test.py',
        );
        const result = provider.scan(input);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]!.pattern, 'eslint');
        assert.equal(result.candidates[0]!.rule, 'no-console');
      });

      it('detects shiori:ignore in hash comment', () => {
        const input = makeInput(
          '# eslint-disable-next-line no-console -- shiori:ignore',
          'test.py',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ignored, true);
        assert.equal(result.annotations[0]!.rule, 'no-console');
      });

      it('does not produce annotations from regular hash comments', () => {
        const input = makeInput('# This is a regular comment', 'test.py');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 0);
      });

      it('handles multiple hash comments', () => {
        const input = makeInput(
          '# shiori: SUP-001\nx = 1\n# shiori: SUP-002',
          'test.py',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 2);
        assert.equal(result.annotations[0]!.ref, 'SUP-001');
        assert.equal(result.annotations[0]!.location.line, 1);
        assert.equal(result.annotations[1]!.ref, 'SUP-002');
        assert.equal(result.annotations[1]!.location.line, 3);
      });

      it('does not detect C-style comments in Python files', () => {
        const input = makeInput('// shiori: SUP-001', 'test.py');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
      });
    });

    describe('HTML-style comments', () => {
      it('detects standalone shiori in HTML comment', () => {
        const input = makeInput('<!-- shiori: SUP-001 -->', 'test.html');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-001');
        assert.equal(result.annotations[0]!.tagged, true);
      });

      it('detects shiori with key=value in HTML comment', () => {
        const input = makeInput(
          '<!-- shiori: SUP-002 expires=2026-06 reason="legacy markup" -->',
          'test.html',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-002');
        assert.equal(result.annotations[0]!.expires, '2026-06');
        assert.equal(result.annotations[0]!.reason, 'legacy markup');
      });

      it('detects shiori in XML comment', () => {
        const input = makeInput('<!-- shiori: XML-001 -->', 'test.xml');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'XML-001');
      });

      it('detects shiori in SVG comment', () => {
        const input = makeInput('<!-- shiori: SVG-001 -->', 'test.svg');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SVG-001');
      });

      it('detects eslint directive in HTML comment', () => {
        const input = makeInput(
          '<!-- eslint-disable-next-line vue/no-v-html -- shiori: SUP-VUE -->',
          'test.html',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-VUE');
        assert.equal(result.annotations[0]!.rule, 'vue/no-v-html');
      });

      it('detects shiori in multi-line HTML comment', () => {
        const input = makeInput('<!--\n  shiori: SUP-ML\n-->', 'test.html');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-ML');
      });

      it('does not detect C-style comments in HTML files', () => {
        const input = makeInput('// shiori: SUP-001', 'test.html');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
      });

      it('does not produce annotations from regular HTML comments', () => {
        const input = makeInput('<!-- Just a comment -->', 'test.html');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
        assert.equal(result.candidates.length, 0);
      });
    });

    describe('SQL-style comments (dashdash)', () => {
      it('detects standalone shiori in SQL line comment', () => {
        const input = makeInput('-- shiori: SQL-001', 'test.sql');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SQL-001');
        assert.equal(result.annotations[0]!.tagged, true);
      });

      it('detects shiori in SQL block comment', () => {
        const input = makeInput('/* shiori: SQL-002 */', 'test.sql');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SQL-002');
      });

      it('does not detect C-style line comment in SQL files', () => {
        const input = makeInput('// shiori: SUP-001', 'test.sql');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 0);
      });
    });

    describe('Lua-style comments', () => {
      it('detects standalone shiori in Lua line comment', () => {
        const input = makeInput('-- shiori: LUA-001', 'test.lua');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'LUA-001');
        assert.equal(result.annotations[0]!.tagged, true);
      });

      it('detects shiori in Lua block comment', () => {
        const input = makeInput('--[[ shiori: LUA-002 ]]', 'test.lua');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'LUA-002');
      });

      it('does not confuse block comment opener with line comment', () => {
        const input = makeInput(
          '--[[ shiori: LUA-BLOCK ]]\n-- shiori: LUA-LINE',
          'test.lua',
        );
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 2);
        assert.equal(result.annotations[0]!.ref, 'LUA-BLOCK');
        assert.equal(result.annotations[1]!.ref, 'LUA-LINE');
      });
    });

    describe('fallback for unknown extensions', () => {
      it('uses C-style syntax for unknown extensions', () => {
        const input = makeInput('// shiori: UNK-001', 'test.unknown');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'UNK-001');
      });

      it('uses C-style block comment for unknown extensions', () => {
        const input = makeInput('/* shiori: UNK-002 */', 'test.xyz');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'UNK-002');
      });
    });

    describe('C-style still works (backward compatibility)', () => {
      it('detects line comment in .ts file', () => {
        const input = makeInput('// shiori: SUP-001', 'test.ts');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-001');
      });

      it('detects block comment in .css file', () => {
        const input = makeInput('/* shiori: SUP-001 */', 'test.css');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'SUP-001');
      });

      it('Vue files use C-style', () => {
        const input = makeInput('// shiori: VUE-001', 'test.vue');
        const result = provider.scan(input);
        assert.equal(result.annotations.length, 1);
        assert.equal(result.annotations[0]!.ref, 'VUE-001');
      });
    });
  });
});
