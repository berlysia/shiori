import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Read package.json exports and return normalized export specifiers.
 * Returns an array of export paths like [".", "./core/ref-pattern", "./commands/show"].
 */
async function getPackageExports(): Promise<string[]> {
  const raw = await readFile(resolve(ROOT, 'package.json'), 'utf-8');
  const pkg = JSON.parse(raw);
  return Object.keys(pkg.exports ?? {});
}

/**
 * Read docs/api.md content.
 */
async function getApiDoc(): Promise<string> {
  return readFile(resolve(ROOT, 'docs/api.md'), 'utf-8');
}

/**
 * Convert a package.json export specifier to the expected import path
 * as it would appear in docs/api.md.
 *
 * "." → "@berlysia/shiori"
 * "./core/ref-pattern" → "@berlysia/shiori/core/ref-pattern"
 */
function exportToImportPath(exportPath: string, packageName: string): string {
  if (exportPath === '.') return packageName;
  return `${packageName}/${exportPath.replace(/^\.\//, '')}`;
}

describe('API contract: package.json exports ↔ docs/api.md', () => {
  it('every package.json export specifier is documented in docs/api.md', async () => {
    const exports = await getPackageExports();
    const doc = await getApiDoc();
    const raw = await readFile(resolve(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    const packageName: string = pkg.name;

    const undocumented: string[] = [];
    for (const exportPath of exports) {
      const importPath = exportToImportPath(exportPath, packageName);
      if (!doc.includes(importPath)) {
        undocumented.push(
          `Export "${exportPath}" (import as "${importPath}") is not documented in docs/api.md`,
        );
      }
    }

    assert.equal(
      undocumented.length,
      0,
      `Undocumented exports found:\n${undocumented.join('\n')}`,
    );
  });

  it('every export entry points to an existing source file', async () => {
    const raw = await readFile(resolve(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    const exports: Record<string, Record<string, string>> = pkg.exports ?? {};

    const missing: string[] = [];
    for (const [specifier, conditions] of Object.entries(exports)) {
      // Check 'import' condition (the actual JS entry point)
      const importPath = conditions.import;
      if (importPath) {
        // Derive the source file from the dist path
        // dist/src/core/types.js → src/core/types.ts
        const sourcePath = importPath
          .replace(/^\.\/dist\//, './')
          .replace(/\.js$/, '.ts');
        try {
          await readFile(resolve(ROOT, sourcePath), 'utf-8');
        } catch {
          missing.push(
            `Export "${specifier}" → source "${sourcePath}" does not exist`,
          );
        }
      }
    }

    assert.equal(
      missing.length,
      0,
      `Missing source files for exports:\n${missing.join('\n')}`,
    );
  });
});

describe('API contract: @berlysia/shiori (core barrel)', () => {
  it('exports all public types and interfaces', async () => {
    const mod = await import('../src/core/types.ts');

    // types.ts exports are type-only except for the module itself
    // Verify the module is importable and has expected shape
    assert.equal(typeof mod, 'object');
  });

  it('exports loadConfig function', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.loadConfig, 'function');
  });

  it('exports resolveConfig function', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.resolveConfig, 'function');
  });

  it('exports loadRegistry function', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.loadRegistry, 'function');
  });

  it('exports parseShioriFields function', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.parseShioriFields, 'function');
  });

  it('resolveConfig returns expected shape with defaults', async () => {
    const { resolveConfig } = await import('../src/core/index.ts');
    const config = resolveConfig({});
    assert.equal(typeof config.candidatePatterns, 'object');
    assert.equal(config.refPatterns, undefined);
    assert.equal(typeof config.paths, 'object');
    assert.equal(typeof config.verify, 'object');
    assert.equal(typeof config.verify.expiringThresholdDays, 'number');
  });

  it('resolveConfig passes through refPatterns', async () => {
    const { resolveConfig } = await import('../src/core/index.ts');
    const patterns = [
      { match: 'JIRA-{id}', urlTemplate: 'https://jira.example.com/{id}' },
    ];
    const config = resolveConfig({ refPatterns: patterns });
    assert.deepEqual(config.refPatterns, patterns);
  });

  it('exports isValidRef function', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.isValidRef, 'function');
  });

  it('exports REF_PATTERN constant', async () => {
    const mod = await import('../src/core/index.ts');
    assert.ok(mod.REF_PATTERN instanceof RegExp);
  });

  it('exports resolveRefUrl from barrel', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.resolveRefUrl, 'function');
  });

  it('exports matchRefPattern from barrel', async () => {
    const mod = await import('../src/core/index.ts');
    assert.equal(typeof mod.matchRefPattern, 'function');
  });

  it('barrel resolveRefUrl produces same result as subpath export', async () => {
    const barrel = await import('../src/core/index.ts');
    const subpath = await import('../src/core/ref-pattern.ts');
    const patterns = [
      {
        match: 'JIRA-{id}',
        urlTemplate: 'https://example.com/browse/JIRA-{id}',
      },
    ];
    assert.equal(
      barrel.resolveRefUrl('JIRA-1234', patterns),
      subpath.resolveRefUrl('JIRA-1234', patterns),
    );
  });

  it('parseShioriFields returns ParsedShioriFields shape', async () => {
    const { parseShioriFields } = await import('../src/core/index.ts');
    const result = parseShioriFields('SUP-1234 expires=2026-06');
    assert.equal(result.ref, 'SUP-1234');
    assert.equal(result.expires, '2026-06');
    assert.ok(Array.isArray(result.errors));
    assert.equal(result.errors.length, 0);
  });
});

describe('API contract: @berlysia/shiori/core/ref-pattern', () => {
  it('exports matchRefPattern function', async () => {
    const mod = await import('../src/core/ref-pattern.ts');
    assert.equal(typeof mod.matchRefPattern, 'function');
  });

  it('exports resolveRefUrl function', async () => {
    const mod = await import('../src/core/ref-pattern.ts');
    assert.equal(typeof mod.resolveRefUrl, 'function');
  });

  it('matchRefPattern returns expected shape', async () => {
    const { matchRefPattern } = await import('../src/core/ref-pattern.ts');
    const result = matchRefPattern('JIRA-1234', [
      { match: 'JIRA-{id}', urlTemplate: 'https://example.com/{id}' },
    ]);
    assert.ok(result);
    assert.equal(typeof result.config, 'object');
    assert.equal(typeof result.captures, 'object');
    assert.equal(result.captures.id, '1234');
  });

  it('resolveRefUrl returns expected shape', async () => {
    const { resolveRefUrl } = await import('../src/core/ref-pattern.ts');
    const url = resolveRefUrl('JIRA-1234', [
      {
        match: 'JIRA-{id}',
        urlTemplate: 'https://example.com/browse/JIRA-{id}',
      },
    ]);
    assert.equal(url, 'https://example.com/browse/JIRA-1234');
  });
});

describe('API contract: @berlysia/shiori/commands/show', () => {
  it('exports show function', async () => {
    const mod = await import('../src/commands/show.ts');
    assert.equal(typeof mod.show, 'function');
  });

  it('exports isFound function', async () => {
    const mod = await import('../src/commands/show.ts');
    assert.equal(typeof mod.isFound, 'function');
  });

  it('show returns expected shape', async () => {
    const { show } = await import('../src/commands/show.ts');
    const result = show({
      ref: 'TEST-001',
      registry: {},
      annotations: [],
      refPatterns: undefined,
    });
    assert.equal(result.ref, 'TEST-001');
    assert.equal(result.registryEntry, undefined);
    assert.ok(Array.isArray(result.sourceLocations));
    assert.equal(result.url, undefined);
  });

  it('isFound returns false for empty result', async () => {
    const { show, isFound } = await import('../src/commands/show.ts');
    const result = show({
      ref: 'NONEXISTENT',
      registry: {},
      annotations: [],
      refPatterns: undefined,
    });
    assert.equal(isFound(result), false);
  });
});
