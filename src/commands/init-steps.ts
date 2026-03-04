/**
 * Step functions for `shiori init`.
 *
 * Each step is a pure-ish async function that performs one phase of
 * initialization and returns a human-readable status message for the
 * summary output.  Extracting steps from init-cli.ts keeps the CLI
 * definition thin and makes the pipeline extensible (e.g. --starter).
 */

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  loadConfig,
  DEFAULT_REGISTRY_PATH,
  CONFIG_FILENAMES,
  type ResolvedConfig,
} from '../core/config.ts';
import { saveRegistry } from '../core/registry.ts';
import { initRegistry } from './registry-generator.ts';
import { fileExists, fileContainsLine } from './init.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import {
  CI_TEMPLATE_KINDS,
  CI_TEMPLATE_LABELS,
  CI_TEMPLATE_PATHS,
  generateCiWorkflow,
  type CiTemplateKind,
} from './init-ci-templates.ts';
import type { ScanResult } from '../core/types.ts';
import {
  STARTER_KINDS,
  STARTER_LABELS,
  generateStarter,
  type StarterKind,
} from '../templates/starter.ts';

// ── Constants ────────────────────────────────────────────────

const GITIGNORE_ENTRY = '.config/shiori/scan-result.json';

export const CONFIG_YAML_TEMPLATE = `# shiori configuration
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
#     - "**/tests/**"
#     - "**/test/**"
#     - "**/__tests__/**"
#     - "**/*.test.*"
#     - "**/*.spec.*"
#     - "**/.config/**"

# File paths (relative to project root)
# paths:
#   scanResult: ".config/shiori/scan-result.json"  # scan result cache
#   registry: ".config/shiori/registry.json"        # annotation registry

# Candidate detection: which comment patterns to detect as candidates
# Built-in tools: eslint, stylelint, typescript, keywords
# candidates:
#   eslint: true            # eslint-disable-next-line, eslint-disable-line
#   stylelint: true         # stylelint-disable-next-line, stylelint-disable-line
#   typescript: false       # @ts-ignore, @ts-expect-error
#   keywords: false         # TODO, FIXME, HACK, XXX comments
#
# Per-matcher control (advanced):
#   eslint:
#     disable-next-line: true
#     disable-line: false
#
# Custom matchers:
#   my-tool:
#     _matchers:
#       my-directive:
#         pattern: "\\bmy-tool-disable\\s+(.*)"
#         rules: csv
#         separator: "--"

# Pattern-based ref resolution (see docs/decisions/012)
# refPatterns:
#   - match: "JIRA-{id}"
#     urlTemplate: "https://jira.example.com/browse/{id}"
#     registryFile: ".config/shiori/registry-jira.json"
#   - match: "ADR-{id}"
#     urlTemplate: "docs/decisions/{id}.md"
`;

// ── Shared context for init pipeline ─────────────────────────

/** Resolved paths and config shared across steps */
export interface InitContext {
  cwd: string;
  config: ResolvedConfig;
  configDir: string;
  scanResultPath: string;
  registryPath: string;
  registryLabel: string;
  gitignorePath: string;
  steps: string[];
  /** Populated after stepScan */
  scanResult?: ScanResult;
}

// ── Argument validation ──────────────────────────────────────

export { CI_TEMPLATE_KINDS, CI_TEMPLATE_LABELS, CI_TEMPLATE_PATHS };
export type { CiTemplateKind };
export { STARTER_KINDS, STARTER_LABELS };
export type { StarterKind };

/** Validate --ci flag value. Returns error message or undefined. */
export function validateCiKind(ciKind: string | undefined): string | undefined {
  if (
    ciKind !== undefined &&
    !CI_TEMPLATE_KINDS.includes(ciKind as CiTemplateKind)
  ) {
    const lines = [
      `Error: Invalid --ci value "${ciKind}". Valid values: ${CI_TEMPLATE_KINDS.join(', ')}`,
    ];
    for (const [kind, label] of Object.entries(CI_TEMPLATE_LABELS)) {
      lines.push(`  ${kind}: ${label}`);
    }
    return lines.join('\n');
  }
  return undefined;
}

/** Validate --starter flag value. Returns error message or undefined. */
export function validateStarterKind(
  starterKind: string | undefined,
): string | undefined {
  if (
    starterKind !== undefined &&
    !STARTER_KINDS.includes(starterKind as StarterKind)
  ) {
    const lines = [
      `Error: Invalid --starter value "${starterKind}". Valid values: ${STARTER_KINDS.join(', ')}`,
    ];
    for (const [kind, label] of Object.entries(STARTER_LABELS)) {
      lines.push(`  ${kind}: ${label}`);
    }
    return lines.join('\n');
  }
  return undefined;
}

// ── Context factory ──────────────────────────────────────────

export interface CreateContextOptions {
  cwd: string;
  configFlag?: string;
  registryFlag?: string;
}

/**
 * Build a shared InitContext from CLI flags and loaded config.
 * Validates all write targets against cwd boundary.
 */
export async function createInitContext(
  opts: CreateContextOptions,
): Promise<InitContext> {
  const { cwd, configFlag, registryFlag } = opts;
  const config = await loadConfig(cwd, configFlag);
  const configDir = join(cwd, '.config', 'shiori');
  const scanResultPath = resolve(cwd, config.paths.scanResult);
  const registryPath = registryFlag
    ? resolve(cwd, registryFlag)
    : join(cwd, DEFAULT_REGISTRY_PATH);
  const gitignorePath = join(cwd, '.gitignore');

  // Validate all write targets are within cwd before any I/O
  await assertWithinCwd(configDir, cwd);
  await assertWithinCwd(scanResultPath, cwd);
  await assertWithinCwd(registryPath, cwd);
  await assertWithinCwd(gitignorePath, cwd);

  return {
    cwd,
    config,
    configDir,
    scanResultPath,
    registryPath,
    registryLabel: registryFlag ?? DEFAULT_REGISTRY_PATH,
    gitignorePath,
    steps: [],
  };
}

// ── Step functions ───────────────────────────────────────────

/** Step 1: Create config directory and config.yaml */
export async function stepConfig(ctx: InitContext): Promise<void> {
  const existing = await findExistingConfig(ctx.configDir);
  if (existing) {
    ctx.steps.push(
      `config: .config/shiori/${existing} already exists, skipped`,
    );
  } else {
    await mkdir(ctx.configDir, { recursive: true });
    await writeFile(
      join(ctx.configDir, 'config.yaml'),
      CONFIG_YAML_TEMPLATE,
      'utf-8',
    );
    ctx.steps.push('config: created .config/shiori/config.yaml');
  }
}

/** Step 2: Scan source files and save scan result */
export async function stepScan(
  ctx: InitContext,
  opts: { patternsFlag?: string; ignoreFlag?: string },
): Promise<void> {
  const patterns = opts.patternsFlag
    ? opts.patternsFlag.split(',').map((s) => s.trim())
    : (ctx.config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

  const ignore = opts.ignoreFlag
    ? opts.ignoreFlag.split(',').map((s) => s.trim())
    : (ctx.config.scanIgnore ?? DEFAULT_SCAN_IGNORE);

  const provider = new CommentProvider();
  const scanResult = await scan({
    patterns,
    ignore,
    provider,
    cwd: ctx.cwd,
    providerOptions: { candidatePatterns: ctx.config.candidatePatterns },
  });
  ctx.scanResult = scanResult;
  ctx.steps.push(
    `scan: ${scanResult.filesScanned} files, ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
  );

  // Save scan result
  await mkdir(dirname(ctx.scanResultPath), { recursive: true });
  await writeFile(
    ctx.scanResultPath,
    JSON.stringify(scanResult, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Step 2.5: Generate starter sample files (between scan and registry).
 *
 * Creates sample source files and merges their registry entries so that
 * the subsequent stepRegistry picks up the starter annotations and
 * `shiori check` passes immediately.
 */
export async function stepStarter(
  ctx: InitContext,
  starterKind: StarterKind,
): Promise<void> {
  const starter = generateStarter(starterKind);

  // Write sample source files (idempotent: skip if already exists)
  let filesCreated = 0;
  let filesSkipped = 0;
  for (const file of starter.files) {
    const filePath = join(ctx.cwd, file.path);
    await assertWithinCwd(filePath, ctx.cwd);
    if (await fileExists(filePath)) {
      filesSkipped++;
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
      filesCreated++;
    }
  }

  // Re-scan to pick up the newly created starter files.
  // The scan result from stepScan may not include the starter files
  // if they were just created — we need a fresh scan for accurate
  // registry generation in the next step.
  if (filesCreated > 0 && ctx.scanResult) {
    const provider = new CommentProvider();
    // Merge starter scan patterns with existing patterns
    const patterns = [
      ...(ctx.config.scanPatterns ?? DEFAULT_SCAN_PATTERNS),
      ...starter.scanPatterns,
    ];
    const ignore = ctx.config.scanIgnore ?? DEFAULT_SCAN_IGNORE;

    const freshScan = await scan({
      patterns,
      ignore,
      provider,
      cwd: ctx.cwd,
      providerOptions: { candidatePatterns: ctx.config.candidatePatterns },
    });
    ctx.scanResult = freshScan;
  }

  if (filesCreated > 0) {
    const msg =
      filesSkipped > 0
        ? `starter: created ${filesCreated} sample file(s), ${filesSkipped} already existed`
        : `starter: created ${filesCreated} sample file(s) (${STARTER_LABELS[starterKind]})`;
    ctx.steps.push(msg);
  } else {
    ctx.steps.push('starter: all sample files already exist, skipped');
  }
}

/** Step 3: Generate registry from scan results */
export async function stepRegistry(ctx: InitContext): Promise<void> {
  if (await fileExists(ctx.registryPath)) {
    ctx.steps.push(`registry: ${ctx.registryLabel} already exists, skipped`);
  } else {
    const annotations = ctx.scanResult?.annotations ?? [];
    const registry = initRegistry({ records: annotations });
    await mkdir(dirname(ctx.registryPath), { recursive: true });
    await saveRegistry(ctx.registryPath, registry);
    const entryCount = Object.keys(registry).length;
    ctx.steps.push(
      `registry: created ${ctx.registryLabel} with ${entryCount} entries`,
    );
  }
}

/** Step 4: Update .gitignore */
export async function stepGitignore(ctx: InitContext): Promise<void> {
  if (await fileContainsLine(ctx.gitignorePath, GITIGNORE_ENTRY)) {
    ctx.steps.push('gitignore: already contains scan-result entry, skipped');
  } else {
    const prefix = (await fileExists(ctx.gitignorePath)) ? '\n' : '';
    await appendFile(
      ctx.gitignorePath,
      `${prefix}${GITIGNORE_ENTRY}\n`,
      'utf-8',
    );
    ctx.steps.push('gitignore: added .config/shiori/scan-result.json');
  }
}

/** Step 5: Generate CI workflow (if --ci is specified) */
export async function stepCi(
  cwd: string,
  ciKind: CiTemplateKind,
  steps: string[],
): Promise<void> {
  const workflowPath = resolve(cwd, CI_TEMPLATE_PATHS[ciKind]);
  await assertWithinCwd(workflowPath, cwd);

  if (await fileExists(workflowPath)) {
    steps.push(`ci: ${CI_TEMPLATE_PATHS[ciKind]} already exists, skipped`);
  } else {
    const content = generateCiWorkflow(ciKind);
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, content, 'utf-8');
    steps.push(
      `ci: created ${CI_TEMPLATE_PATHS[ciKind]} (${CI_TEMPLATE_LABELS[ciKind]})`,
    );
  }
}

/** Step 6: Print summary */
export function stepSummary(
  steps: string[],
  opts: { ciOnly: boolean; ciKind?: CiTemplateKind },
): void {
  console.error('shiori initialized:');
  for (const step of steps) {
    console.error(`  ${step}`);
  }
  console.error('');
  console.error('Next steps:');
  if (!opts.ciOnly) {
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
  }
  if (opts.ciKind) {
    console.error(
      `  ${opts.ciOnly ? '1' : '4'}. Review the generated workflow: ${CI_TEMPLATE_PATHS[opts.ciKind]}`,
    );
    console.error(`  ${opts.ciOnly ? '2' : '5'}. Commit and push to enable CI`);
  } else {
    console.error(
      '  4. Add "shiori check --fail-on missing-in-registry,expired" to CI',
    );
    console.error(
      '     Or run "shiori init --ci basic" to generate a workflow',
    );
  }
  console.error('');
  console.error('Run "shiori docs" for full documentation.');
}

// ── Helpers ──────────────────────────────────────────────────

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

export { PathBoundaryError };
