/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // Rule 1: core/ must not import from commands/ or formatters/
    {
      name: 'core-no-import-upper-layers',
      comment:
        'Core modules must not depend on commands or formatters (unidirectional dependency)',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/(commands|formatters)/' },
    },

    // Rule 2: Command pure logic (non-cli) must not import formatters/
    {
      name: 'commands-no-import-formatters',
      comment:
        'Command pure logic must not depend on formatters (formatters are a sibling layer consumed by CLI wrappers)',
      severity: 'error',
      from: {
        path: '^src/commands/',
        pathNot: '-cli\\.ts$',
      },
      to: { path: '^src/formatters/' },
    },

    // Rule 3: Command pure logic (non-cli) must not import CLI wrappers
    {
      name: 'commands-no-import-cli-wrappers',
      comment:
        'Command pure logic must not depend on CLI wrappers (reverse dependency)',
      severity: 'error',
      from: {
        path: '^src/commands/',
        pathNot: '-cli\\.ts$',
      },
      to: { path: '-cli\\.ts$' },
    },

    // Rule 4: Formatters must not import from commands/
    {
      name: 'formatters-no-import-commands',
      comment:
        'Formatters must not depend on commands (formatters only consume core types)',
      severity: 'error',
      from: { path: '^src/formatters/' },
      to: { path: '^src/commands/' },
    },

    // Rule 5: CLI wrappers must not import cli.ts entry point
    {
      name: 'cli-wrappers-no-import-entry',
      comment:
        'CLI command wrappers must not depend on the main entry point (reverse dependency)',
      severity: 'error',
      from: { path: '-cli\\.ts$' },
      to: { path: '^src/cli\\.ts$' },
    },

    // Rule 6: No horizontal dependencies between command pure logic modules
    // CLI wrappers (-cli.ts) may import any command module.
    // verify.ts is allowed as a composition target (check/report compose it).
    {
      name: 'commands-no-horizontal-deps',
      comment:
        'Command pure logic modules must not import other commands (except verify.ts for composition). Use core/types.ts for shared types.',
      severity: 'error',
      from: {
        path: '^src/commands/',
        pathNot: '-cli\\.ts$',
      },
      to: {
        path: '^src/commands/',
        pathNot: ['verify\\.ts$', '-cli\\.ts$'],
      },
    },

    // Rule 7: No circular dependencies
    {
      name: 'no-circular',
      comment: 'No circular dependencies allowed',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
    cache: {
      strategy: 'content',
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
