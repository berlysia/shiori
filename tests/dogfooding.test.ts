import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import { loadRegistry } from '../src/core/registry.ts';
import { verify } from '../src/commands/verify.ts';

const provider = new CommentProvider();

/**
 * All dogfooding annotations tracked by shiori in its own codebase.
 * Each entry maps a DEV ref to its source file and expected properties.
 */
const DOGFOODING_ANNOTATIONS: {
  ref: string;
  file: string;
  rule?: string;
}[] = [
  {
    ref: 'DEV-001',
    file: 'src/core/path-boundary.ts',
    rule: 'no-constant-condition',
  },
  { ref: 'DEV-002', file: 'src/commands/trend-cli.ts' },
  { ref: 'DEV-003', file: 'src/commands/registry-generator.ts' },
  { ref: 'DEV-004', file: 'src/commands/delta-cli.ts' },
  { ref: 'DEV-005', file: 'src/commands/trend-cli.ts' },
  { ref: 'DEV-006', file: 'src/commands/report-cli.ts' },
  { ref: 'DEV-007', file: 'src/core/config.ts' },
  { ref: 'DEV-008', file: 'src/core/scan-result-loader.ts' },
  { ref: 'DEV-009', file: 'src/core/registry.ts' },
  { ref: 'DEV-010', file: 'src/commands/candidates-cli.ts' },
  { ref: 'DEV-011', file: 'src/commands/verify.ts' },
  { ref: 'DEV-012', file: 'src/core/registry.ts' },
  { ref: 'DEV-013', file: 'src/core/cli-validation.ts' },
  { ref: 'DEV-014', file: 'src/core/cli-validation.ts' },
  { ref: 'DEV-015', file: 'src/core/scan-result-loader.ts' },
  { ref: 'DEV-016', file: 'src/core/scan-result-loader.ts' },
  { ref: 'DEV-017', file: 'src/commands/delta-cli.ts' },
];

const ALL_DEV_REFS = DOGFOODING_ANNOTATIONS.map((a) => a.ref).sort();

describe('dogfooding: shiori tracks its own annotations', () => {
  for (const { ref, file, rule } of DOGFOODING_ANNOTATIONS) {
    it(`detects ${ref} in ${file.replace('src/', '')}`, () => {
      const content = readFileSync(file, 'utf-8');
      const result = provider.scan({ path: file, content });
      const matches = result.annotations.filter((a) => a.ref === ref);
      assert.equal(
        matches.length,
        1,
        `expected exactly 1 annotation for ${ref}`,
      );
      assert.equal(matches[0]!.tagged, true);
      if (rule !== undefined) {
        assert.equal(matches[0]!.rule, rule);
      }
    });
  }

  it('registry contains entries for all DEV- annotations', async () => {
    const { registry, errors } = await loadRegistry(
      '.config/shiori/registry.json',
    );

    assert.equal(errors.length, 0, 'registry should have no validation errors');

    const devRefs = Object.keys(registry)
      .filter((r) => r.startsWith('DEV-'))
      .sort();
    assert.deepEqual(devRefs, ALL_DEV_REFS);
  });

  it('verify reports no issues for dogfooding annotations', async () => {
    // Scan all source files that contain annotations
    const files = [...new Set(DOGFOODING_ANNOTATIONS.map((a) => a.file))];
    const allAnnotations = files.flatMap((f) => {
      const content = readFileSync(f, 'utf-8');
      return provider.scan({ path: f, content }).annotations;
    });

    const { registry } = await loadRegistry('.config/shiori/registry.json');

    const result = verify({
      records: allAnnotations,
      registry,
      failOn: ['missing-in-registry', 'unused-in-source', 'expired'],
      warnOn: ['syntax-error'],
      now: new Date(),
    });

    // Filter to DEV- related issues only
    const devIssues = result.issues.filter((i) => i.ref.startsWith('DEV-'));
    assert.equal(
      devIssues.length,
      0,
      `Expected no DEV- issues, got: ${devIssues.map((i) => `${i.type}:${i.ref}`).join(', ')}`,
    );
  });
});
