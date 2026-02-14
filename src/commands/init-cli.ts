import { define } from 'gunshi';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  loadConfig,
  DEFAULT_SCAN_RESULT_PATH,
  DEFAULT_REGISTRY_PATH,
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
        'Path to directory containing config.json. Default: <cwd>/.config/shiori',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);
    const steps: string[] = [];

    // 1. Create config directory and config.json
    const configDir = join(cwd, '.config', 'shiori');
    const configPath = join(configDir, 'config.json');
    if (await fileExists(configPath)) {
      steps.push('config: .config/shiori/config.json already exists, skipped');
    } else {
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, '{}\n', 'utf-8');
      steps.push('config: created .config/shiori/config.json');
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
      '  1. Review and fill in .config/shiori/registry.json entries',
    );
    console.error('  2. Run "shiori check" to verify');

    // Also save scan result path for convenience
    console.error(`  3. Scan result saved to ${DEFAULT_SCAN_RESULT_PATH}`);
  },
});
