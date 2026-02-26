import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/**
 * Extract export entry point paths from package.json exports field.
 * Returns the subpath keys (e.g. ".", "./core/ref-pattern").
 */
async function getPackageExports(): Promise<string[]> {
  const raw = await readFile(join(ROOT, 'package.json'), 'utf-8');
  const pkg = JSON.parse(raw) as { exports?: Record<string, unknown> };
  if (!pkg.exports) return [];
  return Object.keys(pkg.exports);
}

/**
 * Extract documented entry point paths from docs/api.md.
 * Matches import statements like:
 *   import { ... } from '@berlysia/shiori';
 *   import { ... } from '@berlysia/shiori/core/ref-pattern';
 *
 * Returns the subpath portion (e.g. ".", "./core/ref-pattern").
 */
async function getDocumentedExports(): Promise<string[]> {
  const raw = await readFile(join(ROOT, 'docs/api.md'), 'utf-8');
  const PKG_NAME = '@berlysia/shiori';
  const importPattern = new RegExp(
    `from\\s+['"]${PKG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^'"]*)?['"]`,
    'g',
  );

  const paths = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importPattern.exec(raw)) !== null) {
    const subpath = m[1] ? `.${m[1]}` : '.';
    paths.add(subpath);
  }

  return [...paths].sort();
}

describe('API surface audit', () => {
  it('package.json exports and docs/api.md document the same entry points', async () => {
    const pkgExports = (await getPackageExports()).sort();
    const docExports = await getDocumentedExports();

    // Every package.json export should be documented
    const undocumented = pkgExports.filter((e) => !docExports.includes(e));
    assert.deepEqual(
      undocumented,
      [],
      `Exports in package.json but not documented in docs/api.md: ${undocumented.join(', ')}`,
    );

    // Every documented import should exist in package.json exports
    const phantom = docExports.filter((e) => !pkgExports.includes(e));
    assert.deepEqual(
      phantom,
      [],
      `Documented in docs/api.md but not in package.json exports: ${phantom.join(', ')}`,
    );
  });

  it('all package.json export paths point to existing source files', async () => {
    const raw = await readFile(join(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };
    if (!pkg.exports) return;

    for (const [subpath, targets] of Object.entries(pkg.exports)) {
      // Verify the source .ts file exists (dist may not exist yet)
      // Convert dist/src/X.js → src/X.ts
      const importPath = targets.import;
      if (!importPath) continue;

      const srcPath = importPath
        .replace(/^\.\/dist\//, './')
        .replace(/\.js$/, '.ts');

      try {
        await readFile(join(ROOT, srcPath), 'utf-8');
      } catch {
        assert.fail(
          `Export "${subpath}" points to "${importPath}" but source file "${srcPath}" does not exist`,
        );
      }
    }
  });
});
