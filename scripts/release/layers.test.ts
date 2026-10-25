// Structural test of the dependency direction inside scripts/release/.
//
// lib/ holds pure functions and types. It may import node:path, node:url,
// other files in lib/, and check-changelog.ts (the one heading-format source
// of truth, in a package). Anything that reads a clock, the environment or
// the network is a hidden input and is rejected.
//
// Not transitively pure: check-changelog.ts imports node:fs at its top level,
// so lib/ is only as pure as that file. It has no import-time side effects
// because its `main` runs only when `process.argv[1]` is the file itself. This
// is the exception the design chose (spec "ファイルと層"); the scan is textual
// (no AST) and does not follow imports into it.
//
// plan-2 adds the entrypoint and output-channel rules.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = fileURLToPath(new URL('./lib/', import.meta.url));
const CHECK_CHANGELOG = fileURLToPath(
  new URL(
    '../../packages/shiori-cli/scripts/check-changelog.ts',
    import.meta.url,
  ),
);

const ALLOWED_BARE = new Set(['node:path', 'node:url']);

const IMPORT_PATTERNS: readonly RegExp[] = [
  // import x from 'm' / import 'm' / import type { X } from 'm'
  /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // export { x } from 'm' / export * from 'm'
  /\bexport\s+[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
];
// import(variable) cannot be checked, so it is refused
const COMPUTED_IMPORT = /\b(?:import|require)\s*\(\s*(?!['"])/;

const HIDDEN_INPUTS: readonly [RegExp, string][] = [
  [/\bprocess\./, 'process.'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\bnew\s+Date\s*\(/, 'new Date('],
  [/\bMath\.random\b/, 'Math.random'],
  [/\bfetch\s*\(/, 'fetch('],
];

function stripComments(source: string): string {
  // Only whole-line comments and block comments: a "//" inside a string such
  // as a URL must not swallow the rest of its line.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

export function findViolations(source: string, fileDir: string): string[] {
  const code = stripComments(source);
  const violations: string[] = [];

  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      if (ALLOWED_BARE.has(specifier)) continue;
      if (specifier.startsWith('.')) {
        const target = resolve(fileDir, specifier);
        const inLib =
          dirname(target) === LIB_DIR.replace(/\/$/, '') &&
          target.endsWith('.ts');
        if (inLib || target === CHECK_CHANGELOG) continue;
      }
      violations.push(`import of "${specifier}" is not allowed in lib/`);
    }
  }
  if (COMPUTED_IMPORT.test(code)) {
    violations.push('a computed import()/require() cannot be checked');
  }
  for (const [pattern, name] of HIDDEN_INPUTS) {
    if (pattern.test(code)) violations.push(`hidden input "${name}" in lib/`);
  }
  return violations;
}

function libSources(): string[] {
  return readdirSync(LIB_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

describe('lib/ layer', () => {
  it('scans at least one file', () => {
    assert.ok(libSources().length >= 1);
  });

  it('has no import outside the allow list and no hidden input', () => {
    const found = libSources().flatMap((name) =>
      findViolations(readFileSync(join(LIB_DIR, name), 'utf8'), LIB_DIR).map(
        (violation) => `${name}: ${violation}`,
      ),
    );
    assert.deepEqual(found, []);
  });
});

describe('findViolations', () => {
  const scan = (source: string) => findViolations(source, LIB_DIR);

  it('accepts the allowed imports', () => {
    assert.deepEqual(
      scan(
        [
          "import { join } from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "import { parseVersion } from './semver.ts';",
          "import type { X } from './changeset.ts';",
          "export { y } from './sanitize.ts';",
          "import { hasChangelogSection } from '../../../packages/shiori-cli/scripts/check-changelog.ts';",
        ].join('\n'),
      ),
      [],
    );
  });

  it('flags an import of an entrypoint outside lib/', () => {
    assert.equal(scan("import x from '../release.ts'").length, 1);
  });

  it('flags the testing helpers', () => {
    assert.equal(
      scan("import x from '../testing/test-workspace.ts'").length,
      1,
    );
  });

  it('flags node:fs/promises and bare fs', () => {
    assert.equal(scan("import { readFile } from 'node:fs/promises'").length, 1);
    assert.equal(scan("import fs from 'fs'").length, 1);
  });

  it('flags a dynamic import, a require and a re-export', () => {
    assert.equal(scan("await import('node:child_process')").length, 1);
    assert.equal(scan("const fs = require('node:fs')").length, 1);
    assert.equal(scan("export * from '../deps.ts'").length, 1);
  });

  it('flags a computed import', () => {
    assert.equal(scan('await import(name)').length, 1);
  });

  it('flags each hidden input', () => {
    for (const code of [
      'const t = Date.now()',
      'const d = new Date()',
      'const r = Math.random()',
      "await fetch('x')",
      'const v = process.env.X',
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
  });

  it('ignores comments', () => {
    assert.deepEqual(
      scan(
        "// import x from 'fs' and Date.now()\n/* new Date() */ const a = 1;",
      ),
      [],
    );
  });
});
