import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { check } from './check.ts';
import { formatActionHints } from './verify.ts';
import { formatVerifyOutput } from '../formatters/index.ts';
import {
  parseAndValidateIssueTypes,
  validateOutputFormat,
} from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  detectWorkspaces,
  scanWorkspaces,
  type PackageScanResult,
} from '../core/workspace.ts';

export const checkCommand = define({
  name: 'check',
  description: 'Scan and verify in one step (no intermediate files)',
  examples: `  # One-shot scan + verify
  shiori check

  # Fail on specific issue types
  shiori check --fail-on missing-in-registry,expired

  # Save scan result while checking
  shiori check --save-scan

  # Markdown output
  shiori check -f markdown -o report.md

  # Scan all packages in monorepo workspace
  shiori check --workspace`,
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
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    failOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "missing-in-registry,expired"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "json", "markdown", "sarif", "summary", "jsonl". Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    saveScan: {
      type: 'boolean',
      toKebab: true,
      description:
        'Also save scan result to .config/shiori/scan-result.json (or config path)',
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
    workspace: {
      type: 'boolean',
      toKebab: true,
      description:
        'Scan all packages in monorepo workspace (pnpm/npm workspaces)',
    },
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Overrides config. Default: 14',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;
    const format = validateOutputFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();

    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry, duplicates, refOrigins } = configAndRegistry;

    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : (config.scanIgnore ?? DEFAULT_SCAN_IGNORE);

    const isWorkspaceMode = ctx.values.workspace ?? false;

    // Scan — workspace mode uses detectWorkspaces + scanWorkspaces,
    // single-package mode uses scan() directly.
    const provider = new CommentProvider();
    const scanOptions = {
      patterns,
      ignore,
      provider,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    };

    let scanResult: import('../core/types.ts').ScanResult;
    let packageResults: PackageScanResult[] | undefined;

    if (isWorkspaceMode) {
      const detection = await detectWorkspaces(cwd);
      if (!detection) {
        console.error(
          'Error: No workspace configuration found. Ensure pnpm-workspace.yaml or package.json#workspaces exists.',
        );
        process.exitCode = 1;
        return;
      }

      console.error(
        `Workspace detected (${detection.source}): ${detection.packages.length} package(s)`,
      );

      const workspaceResult = await scanWorkspaces(
        detection.packages,
        cwd,
        scanOptions,
      );
      scanResult = workspaceResult.merged;
      packageResults = workspaceResult.packages;

      // Per-package scan summary
      for (const pkg of workspaceResult.packages) {
        console.error(
          `  ${pkg.package} (${pkg.dir}): ${pkg.scanResult.annotations.length} annotation(s), ${pkg.scanResult.candidates.length} candidate(s)`,
        );
      }
    } else {
      scanResult = await scan({ ...scanOptions, cwd });
    }

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Optionally save scan result
    if (ctx.values.saveScan) {
      const scanOutputPath = resolve(cwd, config.paths.scanResult);
      try {
        await assertWithinCwd(scanOutputPath, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      await mkdir(dirname(scanOutputPath), { recursive: true });
      await writeFile(
        scanOutputPath,
        JSON.stringify(scanResult, null, 2) + '\n',
        'utf-8',
      );
      console.error(`Scan result saved to ${config.paths.scanResult}`);
    }

    // Verify
    const expiringThresholdDays = ctx.values.expiringThreshold
      ? Number(ctx.values.expiringThreshold)
      : config.verify.expiringThresholdDays;

    const { verifyResult } = check({
      scanResult,
      registry,
      failOn,
      warnOn,
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });

    // Format output — workspace mode wraps verifyResult with package breakdown
    let output: string;

    if (isWorkspaceMode && packageResults && format === 'json') {
      // Build per-package issue summary by matching issue file paths to package dirs
      const packageSummaries = packageResults.map((pkg) => {
        const prefix = pkg.dir + '/';
        const pkgIssues = verifyResult.issues.filter((issue) =>
          issue.file?.startsWith(prefix),
        );
        return {
          name: pkg.package,
          dir: pkg.dir,
          issues: pkgIssues.length,
          errors: pkgIssues.filter((i) => i.severity === 'error').length,
          warnings: pkgIssues.filter((i) => i.severity === 'warning').length,
        };
      });

      const workspaceOutput = {
        workspace: true,
        packages: packageSummaries,
        verifyResult,
      };
      output = JSON.stringify(workspaceOutput, null, 2);
    } else {
      output = formatVerifyOutput({
        format,
        verifyResult,
        annotations: scanResult.annotations,
        candidates: scanResult.candidates,
        registry,
      });
    }

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Report',
    });
    if (!written) return;

    for (const hint of formatActionHints(verifyResult)) {
      console.error(hint);
    }

    if (verifyResult.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
