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
// The second half of this file checks the entrypoints above lib/: which file
// may import which, and which files may write to the terminal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
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

// ---------------------------------------------------------------------------
// entrypoints and the output exit
// ---------------------------------------------------------------------------

const ROOT_DIR = fileURLToPath(new URL('./', import.meta.url));

// Paths are relative to scripts/release/ with '/' separators.
const LIB_PREFIX = 'lib/';

// What each non-lib source file may import from this directory.
const ALLOWED_LOCAL: Record<string, (target: string) => boolean> = {
  'release.ts': (t) =>
    t.startsWith(LIB_PREFIX) ||
    ['release-after-push.ts', 'deps.ts', 'output.ts'].includes(t),
  'release-after-push.ts': (t) => t.startsWith(LIB_PREFIX),
  'deps.ts': (t) => t.startsWith(LIB_PREFIX) || t === 'output.ts',
  'output.ts': (t) => t.startsWith(LIB_PREFIX),
  'check-changesets.ts': (t) => t.startsWith(LIB_PREFIX),
};

// release-after-push.ts reaches the outside only through Deps.
const BARE_ALLOWED_IN_AFTER_PUSH = new Set(['node:path', 'node:url']);

const TERMINAL_WRITES: readonly [RegExp, string][] = [
  [/\bconsole\./, 'console.'],
  [/\bprocess\.stdout\.write\b/, 'process.stdout.write'],
  [/\bprocess\.stderr\.write\b/, 'process.stderr.write'],
];
// the files that may write to the terminal directly
const MAY_WRITE_TERMINAL = new Set(['output.ts', 'check-changesets.ts']);

function importSpecifiers(code: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[1] ?? ''),
  );
}

export function findEntrypointViolations(
  file: string,
  source: string,
): string[] {
  const code = stripComments(source);
  const violations: string[] = [];
  const isLib = file.startsWith(LIB_PREFIX);

  if (!isLib) {
    const allowed = ALLOWED_LOCAL[file];
    for (const specifier of importSpecifiers(code)) {
      if (specifier.startsWith('.')) {
        const target = posix.normalize(
          posix.join(posix.dirname(file), specifier),
        );
        if (allowed === undefined || !allowed(target)) {
          violations.push(`${file} must not import ${target}`);
        }
      } else if (
        file === 'release-after-push.ts' &&
        !BARE_ALLOWED_IN_AFTER_PUSH.has(specifier)
      ) {
        violations.push(`${file} must not import ${specifier}`);
      }
    }
  } else {
    // lib/ keeps its own rule above; the entrypoints are named here as well
    // so the two tests cannot disagree about them
    for (const specifier of importSpecifiers(code)) {
      if (!specifier.startsWith('.')) continue;
      const target = posix.normalize(
        posix.join(posix.dirname(file), specifier),
      );
      if (/^(deps|output|release[\w-]*|check-changesets)\.ts$/.test(target)) {
        violations.push(`${file} must not import ${target}`);
      }
    }
  }

  if (!MAY_WRITE_TERMINAL.has(file)) {
    for (const [pattern, name] of TERMINAL_WRITES) {
      if (pattern.test(code)) violations.push(`${file} must not use ${name}`);
    }
  }
  return violations;
}

function entrypointFiles(): string[] {
  const top = readdirSync(ROOT_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  const lib = libSources().map((name) => `${LIB_PREFIX}${name}`);
  return [...top, ...lib].sort();
}

describe('entrypoints and the output exit', () => {
  it('scans every source file outside testing/', () => {
    const files = entrypointFiles();
    for (const expected of [
      'release.ts',
      'release-after-push.ts',
      'deps.ts',
      'output.ts',
      'check-changesets.ts',
    ]) {
      assert.ok(files.includes(expected), `${expected} is scanned`);
    }
  });

  it('has no forbidden import and no write to the terminal outside the exit', () => {
    const found = entrypointFiles().flatMap((file) =>
      findEntrypointViolations(
        file,
        readFileSync(join(ROOT_DIR, file), 'utf8'),
      ),
    );
    assert.deepEqual(found, []);
  });
});

describe('findEntrypointViolations', () => {
  it('flags console.log in lib/entry.ts', () => {
    assert.equal(
      findEntrypointViolations('lib/entry.ts', "console.log('x');").length,
      1,
    );
  });
  it('flags console.error in deps.ts', () => {
    assert.equal(
      findEntrypointViolations('deps.ts', "console.error('x');").length,
      1,
    );
  });
  it('flags process.stdout.write and process.stderr.write in release.ts', () => {
    assert.equal(
      findEntrypointViolations('release.ts', "process.stdout.write('x');")
        .length,
      1,
    );
    assert.equal(
      findEntrypointViolations('release.ts', "process.stderr.write('x');")
        .length,
      1,
    );
  });
  it('allows the terminal in output.ts and check-changesets.ts', () => {
    assert.deepEqual(
      findEntrypointViolations('output.ts', "process.stdout.write('x');"),
      [],
    );
    assert.deepEqual(
      findEntrypointViolations(
        'check-changesets.ts',
        "process.stderr.write('x');",
      ),
      [],
    );
  });
  it('flags check-changesets.ts importing ../deps.ts-style entrypoints', () => {
    assert.equal(
      findEntrypointViolations(
        'check-changesets.ts',
        "import x from './deps.ts';",
      ).length,
      1,
    );
    assert.deepEqual(
      findEntrypointViolations(
        'check-changesets.ts',
        "import x from './lib/changeset.ts';",
      ),
      [],
    );
  });
  it('flags lib/x.ts importing ../output.ts', () => {
    assert.equal(
      findEntrypointViolations('lib/x.ts', "import x from '../output.ts';")
        .length,
      1,
    );
  });
  it('flags release-after-push.ts importing ./release.ts, deps.ts, output.ts or node:fs', () => {
    for (const specifier of [
      './release.ts',
      './deps.ts',
      './output.ts',
      'node:fs',
    ]) {
      assert.equal(
        findEntrypointViolations(
          'release-after-push.ts',
          `import x from '${specifier}';`,
        ).length,
        1,
        specifier,
      );
    }
  });
  it('flags deps.ts and output.ts importing release files', () => {
    assert.equal(
      findEntrypointViolations('deps.ts', "import x from './release.ts';")
        .length,
      1,
    );
    assert.equal(
      findEntrypointViolations('output.ts', "import x from './deps.ts';")
        .length,
      1,
    );
  });
  it('ignores a console mention in a comment', () => {
    assert.deepEqual(
      findEntrypointViolations(
        'release.ts',
        '// console.log is banned\nconst a = 1;',
      ),
      [],
    );
  });
});
