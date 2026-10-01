// Generates .fallowrc.json: the architecture boundary policy checked by `pnpm run lint:boundaries`.
//
// fallow rules are per-zone allow lists, and imports within one zone are always allowed.
// To forbid imports between sibling commands, every command that is neither a composer nor
// a composition target needs a zone of its own. fallow cannot derive per-file zones
// (autoDiscover only splits directories), so this script lists src/commands and writes them out.
//
// Usage:
//   node scripts/gen-fallow-config.mjs          write .fallowrc.json
//   node scripts/gen-fallow-config.mjs --check  exit 1 if .fallowrc.json is stale
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(packageRoot, '.fallowrc.json');

// Modules that compose multiple commands by design, so they may import any command:
//   scan-workspaces → scan, init-steps → scan/init/registry/next-steps/ci-templates,
//   doctor → doctor/* sub-modules, aggregate → summary,
//   triage-wizard-apply → triage-interactive/resolve, scan-demo → scan/verify/report/health,
//   governance-pipeline → scan/report (ADR 031)
const COMPOSERS = [
  'scan-workspaces',
  'init-steps',
  'doctor',
  'aggregate',
  'triage-wizard-apply',
  'scan-demo',
  'governance-pipeline',
];
// Higher-level commands that other commands may import:
//   check → verify, report → verify, health → report, adopt → migrate,
//   health/delta/trend/triage (consumed by summary), onboard (consumed by onboard-interactive)
const TARGETS = [
  'verify',
  'report',
  'migrate',
  'health',
  'delta',
  'trend',
  'triage',
  'onboard',
];
// summary composes health/delta/trend/triage and is itself consumed by aggregate.
const SUMMARY = 'summary';

function buildConfig() {
  const commandNames = readdirSync(join(packageRoot, 'src/commands'))
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !file.endsWith('-cli.ts') && file !== 'command-map.ts')
    .map((file) => file.slice(0, -'.ts'.length))
    .sort();
  const grouped = new Set([...COMPOSERS, ...TARGETS, SUMMARY]);
  const missing = [...grouped].filter((name) => !commandNames.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `gen-fallow-config: listed commands not found in src/commands: ${missing.join(', ')}`,
    );
  }
  const leaves = commandNames.filter((name) => !grouped.has(name));
  const leafZone = (name) => `cmd-leaf-${name}`;
  const allCommandZones = [
    'cmd-composer',
    'cmd-summary',
    'cmd-target',
    ...leaves.map(leafZone),
  ];
  // Pure command logic may import core and the composition targets only:
  // not formatters, not *-cli.ts wrappers, not sibling commands.
  const commandAllow = ['core', 'entry', 'cmd-target', 'cmd-summary'];

  return {
    $schema: './node_modules/fallow/schema.json',
    boundaries: {
      // First matching zone wins, so the more specific zones come first.
      zones: [
        { name: 'entry', patterns: ['src/cli.ts'] },
        { name: 'cli-wrapper', patterns: ['src/commands/*-cli.ts'] },
        // CLI registration map (ADR 030): may import *-cli.ts wrappers.
        { name: 'command-map', patterns: ['src/commands/command-map.ts'] },
        {
          name: 'cmd-composer',
          patterns: [
            ...COMPOSERS.map((name) => `src/commands/${name}.ts`),
            'src/commands/doctor/**',
          ],
        },
        { name: 'cmd-summary', patterns: [`src/commands/${SUMMARY}.ts`] },
        {
          name: 'cmd-target',
          patterns: TARGETS.map((name) => `src/commands/${name}.ts`),
        },
        ...leaves.map((name) => ({
          name: leafZone(name),
          patterns: [`src/commands/${name}.ts`],
        })),
        { name: 'formatters', patterns: ['src/formatters/**'] },
        { name: 'core', patterns: ['src/core/**'] },
      ],
      rules: [
        { from: 'core', allow: ['entry'] },
        { from: 'formatters', allow: ['core', 'entry'] },
        // Wrappers may import anything except the cli.ts entry point.
        {
          from: 'cli-wrapper',
          allow: ['core', 'formatters', 'command-map', ...allCommandZones],
        },
        { from: 'command-map', allow: [...commandAllow, 'cli-wrapper'] },
        { from: 'cmd-composer', allow: ['core', 'entry', ...allCommandZones] },
        { from: 'cmd-summary', allow: ['core', 'entry', ...allCommandZones] },
        { from: 'cmd-target', allow: commandAllow },
        ...leaves.map((name) => ({
          from: leafZone(name),
          allow: commandAllow,
        })),
      ],
      // A new src file outside every zone fails the check instead of escaping the policy.
      coverage: {
        requireAllFiles: true,
        allowUnmatched: [
          'tests/**',
          'scripts/**',
          'src/playground/**',
          'src/templates/**',
          '*.config.*',
        ],
      },
    },
  };
}

const generated = `${JSON.stringify(buildConfig(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(configPath, 'utf8');
  } catch {
    // A missing file is reported as stale below.
  }
  if (current !== generated) {
    console.error(
      'packages/shiori-cli/.fallowrc.json is out of date with src/commands.\n' +
        'fix: pnpm --filter @berlysia/shiori run gen:boundaries',
    );
    process.exit(1);
  }
} else {
  writeFileSync(configPath, generated);
}
