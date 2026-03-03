import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import { loadRegistry } from '../src/core/registry.ts';
import { verify } from '../src/commands/verify.ts';

const provider = new CommentProvider();

describe('dogfooding: shiori tracks its own annotations', () => {
  it('detects DEV-001 in path-boundary.ts (eslint suppress)', () => {
    const content = readFileSync('src/core/path-boundary.ts', 'utf-8');
    const result = provider.scan({
      path: 'src/core/path-boundary.ts',
      content,
    });
    const devAnnotations = result.annotations.filter(
      (a) => a.ref === 'DEV-001',
    );
    assert.equal(devAnnotations.length, 1);
    assert.equal(devAnnotations[0]!.rule, 'no-constant-condition');
    assert.equal(devAnnotations[0]!.tagged, true);
  });

  it('detects DEV-002 in trend-cli.ts (type assertion)', () => {
    const content = readFileSync('src/commands/trend-cli.ts', 'utf-8');
    const result = provider.scan({
      path: 'src/commands/trend-cli.ts',
      content,
    });
    const devAnnotations = result.annotations.filter(
      (a) => a.ref === 'DEV-002',
    );
    assert.equal(devAnnotations.length, 1);
    assert.equal(devAnnotations[0]!.rule, undefined);
    assert.equal(devAnnotations[0]!.tagged, true);
  });

  it('detects DEV-003 in registry-generator.ts (design decision)', () => {
    const content = readFileSync('src/commands/registry-generator.ts', 'utf-8');
    const result = provider.scan({
      path: 'src/commands/registry-generator.ts',
      content,
    });
    const devAnnotations = result.annotations.filter(
      (a) => a.ref === 'DEV-003',
    );
    assert.equal(devAnnotations.length, 1);
    assert.equal(devAnnotations[0]!.rule, undefined);
    assert.equal(devAnnotations[0]!.tagged, true);
  });

  it('registry contains entries for all DEV- annotations', async () => {
    const { registry, errors } = await loadRegistry(
      '.config/shiori/registry.json',
    );

    assert.equal(errors.length, 0, 'registry should have no validation errors');

    const devRefs = Object.keys(registry)
      .filter((r) => r.startsWith('DEV-'))
      .sort();
    assert.deepEqual(devRefs, ['DEV-001', 'DEV-002', 'DEV-003']);
  });

  it('verify reports no issues for dogfooding annotations', async () => {
    // Scan all 3 files with annotations
    const files = [
      'src/core/path-boundary.ts',
      'src/commands/trend-cli.ts',
      'src/commands/registry-generator.ts',
    ];
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
