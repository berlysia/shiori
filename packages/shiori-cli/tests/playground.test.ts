import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Tests for the playground browser bundle entry point.
 *
 * These tests verify that:
 * 1. The playground module exports the expected API surface
 * 2. The exported functions work correctly as a cohesive unit
 * 3. No Node.js-only imports leak into the entry point
 */

const ROOT = join(import.meta.dirname, '..');

describe('playground: API surface', () => {
  it('exports parseShioriFields', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.parseShioriFields, 'function');
  });

  it('exports CommentProvider', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.CommentProvider, 'function');
  });

  it('exports verify', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.verify, 'function');
  });

  it('exports isValidRef', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.isValidRef, 'function');
  });

  it('exports getCommentSyntax', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.getCommentSyntax, 'function');
  });

  it('exports VERIFY_ISSUE_TYPES', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.ok(Array.isArray(mod.VERIFY_ISSUE_TYPES));
  });

  it('exports COMMENT_SYNTAXES and EXTENSION_MAP', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(typeof mod.COMMENT_SYNTAXES, 'object');
    assert.equal(typeof mod.EXTENSION_MAP, 'object');
  });

  it('exports REF_PATTERN', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.ok(mod.REF_PATTERN instanceof RegExp);
  });
});

describe('playground: end-to-end flow', () => {
  it('scan + verify round-trip produces correct results', async () => {
    const mod = await import('../src/playground/index.ts');

    const code = [
      '// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06',
      'console.log("hello");',
      '',
      '// shiori: ADR:0007 reason="design decision"',
      '',
      '// @ts-expect-error',
      'const x: any = 42;',
    ].join('\n');

    const provider = new mod.CommentProvider();
    const result = provider.scan({ path: 'example.ts', content: code });

    // Should find 2 tracked annotations
    const tracked = result.annotations.filter(
      (a: { ignored: boolean }) => !a.ignored,
    );
    assert.equal(tracked.length, 2);
    assert.equal(tracked[0]!.ref, 'SUP-1234');
    assert.equal(tracked[0]!.rule, 'no-console');
    assert.equal(tracked[0]!.expires, '2026-06');
    assert.equal(tracked[1]!.ref, 'ADR:0007');
    assert.equal(tracked[1]!.reason, 'design decision');

    // ts-expect-error directive is not in DEFAULT_CANDIDATE_PATTERNS, so 0 candidates
    assert.equal(result.candidates.length, 0);

    // Verify against a sample registry
    const registry = {
      'SUP-1234': {
        reason: 'Legacy logging',
        target: 'src/app.ts',
        expires: '2026-06',
        ticket: undefined,
        owner: 'team-platform',
        notes: undefined,
        kind: 'workaround',
      },
    };

    const verifyResult = mod.verify({
      records: tracked,
      registry,
      failOn: ['missing-in-registry', 'expired', 'syntax-error'],
      warnOn: ['unused-in-source', 'expiring-soon'],
    });

    // ADR:0007 should be missing-in-registry
    const missingIssues = verifyResult.issues.filter(
      (i: { type: string }) => i.type === 'missing-in-registry',
    );
    assert.equal(missingIssues.length, 1);
    assert.equal(missingIssues[0]!.ref, 'ADR:0007');
  });

  it('handles different file extensions via getCommentSyntax', async () => {
    const mod = await import('../src/playground/index.ts');
    const provider = new mod.CommentProvider();

    // Python-style comment
    const pyCode = '# shiori: PY-001 reason="python annotation"';
    const pyResult = provider.scan({ path: 'example.py', content: pyCode });
    assert.equal(pyResult.annotations.length, 1);
    assert.equal(pyResult.annotations[0]!.ref, 'PY-001');

    // HTML-style comment
    const htmlCode = '<!-- shiori: HTML-001 reason="html annotation" -->';
    const htmlResult = provider.scan({
      path: 'example.html',
      content: htmlCode,
    });
    assert.equal(htmlResult.annotations.length, 1);
    assert.equal(htmlResult.annotations[0]!.ref, 'HTML-001');
  });

  it('validates refs correctly', async () => {
    const mod = await import('../src/playground/index.ts');
    assert.equal(mod.isValidRef('SUP-1234'), true);
    assert.equal(mod.isValidRef('ADR:0007'), true);
    assert.equal(mod.isValidRef(''), false);
    assert.equal(mod.isValidRef('lowercase'), false);
  });
});

describe('playground: bundle artifact', () => {
  it('build:playground produces output file', async () => {
    const bundlePath = join(ROOT, 'playground', 'shiori-playground.js');
    const info = await stat(bundlePath);
    assert.ok(info.isFile(), 'Bundle file should exist');
    // Bundle should be under 30KB (current ~10KB)
    assert.ok(
      info.size < 30 * 1024,
      `Bundle size ${info.size} exceeds 30KB limit`,
    );
    assert.ok(
      info.size > 1024,
      `Bundle size ${info.size} is suspiciously small`,
    );
  });

  it('build:playground produces HTML file', async () => {
    const htmlPath = join(ROOT, 'playground', 'index.html');
    const content = await readFile(htmlPath, 'utf-8');
    assert.ok(
      content.includes('shiori Playground'),
      'HTML should contain title',
    );
    assert.ok(
      content.includes('shiori-playground.js'),
      'HTML should reference bundle',
    );
  });

  it('build:playground produces source map', async () => {
    const mapPath = join(ROOT, 'playground', 'shiori-playground.js.map');
    const info = await stat(mapPath);
    assert.ok(info.isFile(), 'Source map should exist');
  });

  it('entry point has no Node.js-only imports', async () => {
    // Read the entry file and its direct dependencies to verify
    // no node: protocol imports exist in the playground dependency chain
    const entryContent = await readFile(
      join(ROOT, 'src/playground/index.ts'),
      'utf-8',
    );
    assert.ok(
      !entryContent.includes("from 'node:"),
      'Entry point must not import node: modules',
    );

    // Verify transitive dependencies used by playground are node-free
    const coreDeps = [
      'src/core/parser.ts',
      'src/core/comment-syntax.ts',
      'src/core/regex-utils.ts',
      'src/core/ref-validation.ts',
      'src/core/ref-pattern.ts',
      'src/core/providers/AnnotationProvider.ts',
      'src/core/providers/CommentProvider.ts',
      'src/commands/verify.ts',
    ];

    for (const dep of coreDeps) {
      const content = await readFile(join(ROOT, dep), 'utf-8');
      assert.ok(
        !content.includes("from 'node:"),
        `${dep} must not import node: modules (required for browser bundle)`,
      );
    }
  });
});
