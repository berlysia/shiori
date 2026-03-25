import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Registry } from '../src/core/types.ts';
import {
  buildAnnotationString,
  lineHasComment,
  planAnnotation,
  formatAnnotatePreview,
  AnnotateError,
} from '../src/commands/annotate.ts';
import {
  formatAnnotateAsJson,
  type AnnotateJsonOutput,
} from '../src/formatters/annotate-formatter.ts';

describe('buildAnnotationString', () => {
  it('returns ref only when no fields', () => {
    assert.equal(buildAnnotationString('SUP-1234'), 'SUP-1234');
  });

  it('appends expires field', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { expires: '2026-06' }),
      'SUP-1234 expires=2026-06',
    );
  });

  it('appends reason without quotes when no spaces', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'workaround' }),
      'SUP-1234 reason=workaround',
    );
  });

  it('quotes reason with spaces', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'legacy code issue' }),
      'SUP-1234 reason="legacy code issue"',
    );
  });

  it('appends both expires and reason', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', {
        expires: '2026-06',
        reason: 'temporary fix',
      }),
      'SUP-1234 expires=2026-06 reason="temporary fix"',
    );
  });

  it('escapes double quotes in reason', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'say "hello"' }),
      'SUP-1234 reason="say \\"hello\\""',
    );
  });

  it('escapes backslashes in reason without spaces (no quoting needed)', () => {
    // No spaces or quotes → no quoting applied, backslashes pass through
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'path\\to\\file' }),
      'SUP-1234 reason=path\\to\\file',
    );
  });

  it('escapes backslashes in reason with spaces (quoting applied)', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'path \\to\\ file' }),
      'SUP-1234 reason="path \\\\to\\\\ file"',
    );
  });

  it('escapes both backslashes and quotes in reason', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: 'a \\"b\\" c' }),
      'SUP-1234 reason="a \\\\\\"b\\\\\\" c"',
    );
  });

  it('quotes reason containing only quotes (no spaces)', () => {
    assert.equal(
      buildAnnotationString('SUP-1234', { reason: '"quoted"' }),
      'SUP-1234 reason="\\"quoted\\""',
    );
  });
});

describe('lineHasComment', () => {
  it('detects JS line comment', () => {
    assert.equal(
      lineHasComment('  // eslint-disable-next-line', 'app.ts'),
      true,
    );
  });

  it('detects Python hash comment', () => {
    assert.equal(lineHasComment('  # noqa', 'script.py'), true);
  });

  it('detects HTML block comment', () => {
    assert.equal(lineHasComment('  <!-- comment -->', 'index.html'), true);
  });

  it('detects CSS block comment', () => {
    assert.equal(
      lineHasComment('  /* stylelint-disable */', 'style.css'),
      true,
    );
  });

  it('returns false for code-only line', () => {
    assert.equal(lineHasComment('  const x = 1;', 'app.ts'), false);
  });

  it('returns false for empty line', () => {
    assert.equal(lineHasComment('', 'app.ts'), false);
  });
});

describe('planAnnotation', () => {
  const emptyRegistry: Registry = {};

  it('inserts annotation into lint directive with -- separator', () => {
    const content =
      '// eslint-disable-next-line no-console\nconsole.log("hi");\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, false);
    assert.ok(result.content.includes('-- shiori: SUP-1234'));
    assert.equal(result.ref, 'SUP-1234');
  });

  it('appends annotation to regular comment', () => {
    const content = '// TODO: fix this later\nconst x = 1;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, false);
    assert.ok(result.content.includes('shiori: SUP-1234'));
  });

  it('inserts new comment line above code-only line', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, true);
    const lines = result.content.split('\n');
    assert.ok(lines[0]!.includes('// shiori: SUP-1234'));
    assert.equal(lines[1], 'const x = 1;');
  });

  it('uses # prefix for Python files', () => {
    const content = 'x = 1\ny = 2\n';
    const result = planAnnotation({
      file: 'script.py',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, true);
    const lines = result.content.split('\n');
    assert.ok(lines[0]!.includes('# shiori: SUP-1234'));
  });

  it('uses block comment syntax for HTML files', () => {
    const content = '<div>hello</div>\n<p>world</p>\n';
    const result = planAnnotation({
      file: 'index.html',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, true);
    const lines = result.content.split('\n');
    assert.ok(lines[0]!.includes('<!-- shiori: SUP-1234 -->'));
  });

  it('preserves indentation when inserting new line', () => {
    const content = '  const x = 1;\n  const y = 2;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, true);
    const lines = result.content.split('\n');
    assert.ok(lines[0]!.startsWith('  // shiori:'));
  });

  it('throws on duplicate shiori annotation', () => {
    const content =
      '// eslint-disable-next-line -- shiori: EXISTING-001\nconsole.log("hi");\n';
    assert.throws(
      () =>
        planAnnotation({
          file: 'app.ts',
          line: 1,
          ref: 'SUP-1234',
          content,
          existingRegistry: emptyRegistry,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AnnotateError);
        assert.ok(err.message.includes('already has a shiori annotation'));
        return true;
      },
    );
  });

  it('throws on registry collision', () => {
    const existingRegistry: Registry = {
      'SUP-1234': {
        reason: 'existing',
        target: 'other.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const content = 'const x = 1;\n';
    assert.throws(
      () =>
        planAnnotation({
          file: 'app.ts',
          line: 1,
          ref: 'SUP-1234',
          content,
          existingRegistry,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AnnotateError);
        assert.ok(err.message.includes('already exists in registry'));
        return true;
      },
    );
  });

  it('throws on line out of range', () => {
    const content = 'line1\nline2\n';
    assert.throws(
      () =>
        planAnnotation({
          file: 'app.ts',
          line: 10,
          ref: 'SUP-1234',
          content,
          existingRegistry: emptyRegistry,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AnnotateError);
        assert.ok(err.message.includes('out of range'));
        return true;
      },
    );
  });

  it('throws on invalid ref format', () => {
    const content = 'const x = 1;\n';
    assert.throws(
      () =>
        planAnnotation({
          file: 'app.ts',
          line: 1,
          ref: 'invalid-ref',
          content,
          existingRegistry: emptyRegistry,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AnnotateError);
        assert.ok(err.message.includes('Invalid ref'));
        return true;
      },
    );
  });

  it('includes expires and reason in annotation string', () => {
    const content = 'const x = 1;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      expires: '2026-06',
      reason: 'temporary fix',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, true);
    const firstLine = result.content.split('\n')[0]!;
    assert.ok(firstLine.includes('expires=2026-06'));
    assert.ok(firstLine.includes('reason="temporary fix"'));
  });

  it('sets registry entry with default reason and kind', () => {
    const content = 'const x = 1;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.registryEntry.reason, 'annotated by shiori annotate');
    assert.equal(result.registryEntry.kind, 'annotation');
    assert.equal(result.registryEntry.target, 'app.ts');
  });

  it('sets registry entry with custom reason, kind, and expires', () => {
    const content = 'const x = 1;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      reason: 'workaround',
      expires: '2026-12',
      kind: 'tech-debt',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.registryEntry.reason, 'workaround');
    assert.equal(result.registryEntry.kind, 'tech-debt');
    assert.equal(result.registryEntry.expires, '2026-12');
  });

  it('handles inline lint directive (eslint-disable-line)', () => {
    const content = 'console.log("hi"); // eslint-disable-line no-console\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });

    assert.equal(result.lineInserted, false);
    assert.ok(result.content.includes('-- shiori: SUP-1234'));
  });
});

describe('formatAnnotatePreview', () => {
  it('shows preview for line insertion', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: {},
    });
    const preview = formatAnnotatePreview({ file: 'app.ts', line: 1 }, result);

    assert.ok(preview.includes('Target: app.ts:1'));
    assert.ok(preview.includes('Ref: SUP-1234'));
    assert.ok(preview.includes('Insert new comment line above'));
    assert.ok(preview.includes('Registry entry:'));
  });

  it('shows preview for comment modification', () => {
    const content =
      '// eslint-disable-next-line no-console\nconsole.log("hi");\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: {},
    });
    const preview = formatAnnotatePreview({ file: 'app.ts', line: 1 }, result);

    assert.ok(preview.includes('Target: app.ts:1'));
    assert.ok(preview.includes('Append annotation to existing comment'));
  });
});

describe('formatAnnotateAsJson', () => {
  const emptyRegistry: Registry = {};

  it('returns valid JSON with correct schema for line insertion', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });
    const jsonStr = formatAnnotateAsJson({ file: 'app.ts', line: 1 }, result);
    const envelope = JSON.parse(jsonStr);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'annotate');
    assert.equal(envelope.meta.schemaVersion, 1);
    const output: AnnotateJsonOutput = envelope.data;

    assert.equal(output.file, 'app.ts');
    assert.equal(output.line, 1);
    assert.equal(output.ref, 'SUP-1234');
    assert.equal(output.action, 'insert');
    assert.equal(output.lineInserted, true);
    assert.ok(output.annotationLine.includes('shiori: SUP-1234'));
    assert.equal(output.registryEntry.reason, 'annotated by shiori annotate');
    assert.equal(output.registryEntry.kind, 'annotation');
    assert.equal(output.registryEntry.target, 'app.ts');
    assert.deepEqual(output.warnings, []);
  });

  it('returns action=append for existing comment modification', () => {
    const content =
      '// eslint-disable-next-line no-console\nconsole.log("hi");\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });
    const jsonStr = formatAnnotateAsJson({ file: 'app.ts', line: 1 }, result);
    const envelope = JSON.parse(jsonStr);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'annotate');
    assert.equal(envelope.meta.schemaVersion, 1);
    const output: AnnotateJsonOutput = envelope.data;

    assert.equal(output.action, 'append');
    assert.equal(output.lineInserted, false);
    assert.ok(output.annotationLine.includes('shiori: SUP-1234'));
  });

  it('includes custom fields in registry entry', () => {
    const content = 'const x = 1;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-5678',
      reason: 'workaround',
      expires: '2026-12',
      kind: 'tech-debt',
      content,
      existingRegistry: emptyRegistry,
    });
    const jsonStr = formatAnnotateAsJson({ file: 'app.ts', line: 1 }, result);
    const envelope = JSON.parse(jsonStr);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'annotate');
    assert.equal(envelope.meta.schemaVersion, 1);
    const output: AnnotateJsonOutput = envelope.data;

    assert.equal(output.registryEntry.reason, 'workaround');
    assert.equal(output.registryEntry.expires, '2026-12');
    assert.equal(output.registryEntry.kind, 'tech-debt');
  });

  it('includes warnings in output', () => {
    // Create a very long line that triggers the length warning
    const longComment = '// ' + 'a'.repeat(200);
    const content = longComment + '\nconst y = 2;\n';
    const result = planAnnotation({
      file: 'app.ts',
      line: 1,
      ref: 'SUP-1234',
      content,
      existingRegistry: emptyRegistry,
    });
    const jsonStr = formatAnnotateAsJson({ file: 'app.ts', line: 1 }, result);
    const envelope = JSON.parse(jsonStr);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'annotate');
    assert.equal(envelope.meta.schemaVersion, 1);
    const output: AnnotateJsonOutput = envelope.data;

    assert.ok(output.warnings.length > 0);
    assert.ok(output.warnings[0]!.includes('line length'));
  });
});
