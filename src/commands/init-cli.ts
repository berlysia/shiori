import { define } from 'gunshi';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  loadConfig,
  DEFAULT_REGISTRY_PATH,
  CONFIG_FILENAMES,
} from '../core/config.ts';
import { saveRegistry } from '../core/registry.ts';
import { initRegistry } from './registry-generator.ts';
import { fileExists, fileContainsLine } from './init.ts';

const DEFAULT_PATTERNS = ['**/*.{css,scss,pcss,js,ts,tsx,jsx}'];
const DEFAULT_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

const GITIGNORE_ENTRY = '.config/shiori/scan-result.json';

export const initCommand = define({
  name: 'init',
  description: 'Initialize shiori in a project',
  examples: `  # Initialize with defaults
  shiori init

  # Initialize with custom registry path
  shiori init --registry custom-registry.yaml

  # Initialize with custom scan patterns
  shiori init -p "src/**/*.ts"`,
  rendering: { header: null },
  args: {
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    registry: {
      type: 'string',
      short: 'r',
      description: `Output registry file path. Default: "${DEFAULT_REGISTRY_PATH}"`,
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);
    const steps: string[] = [];

    // 1. Create config directory and config.yaml
    const configDir = join(cwd, '.config', 'shiori');
    const existingConfig = await findExistingConfig(configDir);
    if (existingConfig) {
      steps.push(
        `config: .config/shiori/${existingConfig} already exists, skipped`,
      );
    } else {
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        CONFIG_YAML_TEMPLATE,
        'utf-8',
      );
      steps.push('config: created .config/shiori/config.yaml');
    }

    // 2. Scan source files
    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : (config.scanIgnore ?? DEFAULT_IGNORE);

    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });
    steps.push(
      `scan: ${scanResult.filesScanned} files, ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Save scan result
    const scanResultPath = join(cwd, config.paths.scanResult);
    await mkdir(dirname(scanResultPath), { recursive: true });
    await writeFile(
      scanResultPath,
      JSON.stringify(scanResult, null, 2) + '\n',
      'utf-8',
    );

    // 3. Generate registry
    const registryPath =
      ctx.values.registry ?? join(cwd, DEFAULT_REGISTRY_PATH);
    if (await fileExists(registryPath)) {
      steps.push(
        `registry: ${ctx.values.registry ?? DEFAULT_REGISTRY_PATH} already exists, skipped`,
      );
    } else {
      const registry = initRegistry({ records: scanResult.annotations });
      await saveRegistry(registryPath, registry);
      const entryCount = Object.keys(registry).length;
      steps.push(
        `registry: created ${ctx.values.registry ?? DEFAULT_REGISTRY_PATH} with ${entryCount} entries`,
      );
    }

    // 4. Update .gitignore
    const gitignorePath = join(cwd, '.gitignore');
    if (await fileContainsLine(gitignorePath, GITIGNORE_ENTRY)) {
      steps.push('gitignore: already contains scan-result entry, skipped');
    } else {
      const prefix = (await fileExists(gitignorePath)) ? '\n' : '';
      await appendFile(gitignorePath, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf-8');
      steps.push('gitignore: added .config/shiori/scan-result.json');
    }

    // 5. Summary
    console.error('shiori initialized:');
    for (const step of steps) {
      console.error(`  ${step}`);
    }
    console.error('');
    console.error('Next steps:');
    console.error(
      '  1. Review and fill in registry entries (reason, owner, expires):',
    );
    console.error('     .config/shiori/registry.json');
    console.error(
      '  2. Run "shiori check" to verify annotations match the registry',
    );
    console.error(
      '  3. Fix issues: "shiori update" adds missing refs to the registry',
    );
    console.error(
      '  4. Add "shiori check --fail-on missing-in-registry,expired" to CI',
    );
    console.error('');
    console.error('Workflow: init → check → update → check → CI');
    console.error('');
    console.error('Run "shiori docs" for full documentation.');
  },
});

/** Check if any config file already exists in the directory */
async function findExistingConfig(
  configDir: string,
): Promise<string | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    if (await fileExists(join(configDir, filename))) {
      return filename;
    }
  }
  return undefined;
}

const CONFIG_YAML_TEMPLATE = `# shiori configuration
# See: https://github.com/berlysia/shiori

# Scan options: default glob patterns for source file scanning
# scan:
#   patterns:
#     - "**/*.{js,ts,tsx,jsx}"
#     - "**/*.{css,scss,pcss}"
#   ignore:
#     - "**/node_modules/**"
#     - "**/dist/**"
#     - "**/.git/**"

# File paths (relative to project root)
# paths:
#   scanResult: ".config/shiori/scan-result.json"  # scan result cache
#   registry: ".config/shiori/registry.json"        # annotation registry

# Candidate detection patterns: which comment patterns to detect as candidates
# candidates:
#   lint-disable: true   # eslint-disable, stylelint-disable, etc.
#   todo: false           # TODO comments
#   fixme: false          # FIXME comments
#   hack: false           # HACK comments
#   xxx: false            # XXX comments

# Pattern-based ref resolution (see docs/decisions/012)
# refPatterns:
#   - match: "JIRA-{id}"
#     urlTemplate: "https://jira.example.com/browse/{id}"
#     registryFile: ".config/shiori/registry-jira.json"
#   - match: "ADR-{id}"
#     urlTemplate: "docs/decisions/{id}.md"
`;
