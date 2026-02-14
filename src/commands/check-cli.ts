import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VerifyIssueType } from '../core/types.ts';
import { loadConfig, resolveRegistryPath } from '../core/config.ts';
import { loadRegistry } from '../core/registry.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { check, type OutputFormat } from './check.ts';
import {
  formatVerifyResultAsMarkdown,
  formatActionHints,
} from './verify.ts';

const DEFAULT_PATTERNS = ['**/*.{css,scss,pcss,js,ts,tsx,jsx}'];
const DEFAULT_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

function parseIssueTypes(value: string | undefined): VerifyIssueType[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()) as VerifyIssueType[];
}

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
  shiori check -f markdown -o report.md`,
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
      description: 'Output format: "json" or "markdown". Default: "json"',
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
        'Path to directory containing config.json. Default: <cwd>/.config/shiori',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);

    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : (config.scanIgnore ?? DEFAULT_IGNORE);

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Optionally save scan result
    if (ctx.values.saveScan) {
      const scanOutputPath = join(cwd, config.paths.scanResult);
      await mkdir(dirname(scanOutputPath), { recursive: true });
      await writeFile(
        scanOutputPath,
        JSON.stringify(scanResult, null, 2) + '\n',
        'utf-8',
      );
      console.error(`Scan result saved to ${config.paths.scanResult}`);
    }

    // Load registry
    const registryPath = await resolveRegistryPath(
      ctx.values.registry,
      config,
      cwd,
    );
    const { registry, errors: registryErrors } =
      await loadRegistry(registryPath);
    if (registryErrors.length > 0) {
      console.error('Registry validation errors:');
      for (const err of registryErrors) {
        console.error(`  ${err.id}: ${err.message}`);
      }
    }

    // Verify
    const { verifyResult } = check({
      scanResult,
      registry,
      failOn: parseIssueTypes(ctx.values.failOn),
      warnOn: parseIssueTypes(ctx.values.warnOn),
    });

    const format = (ctx.values.format ?? 'json') as OutputFormat;
    const output =
      format === 'markdown'
        ? formatVerifyResultAsMarkdown(verifyResult)
        : JSON.stringify(verifyResult, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, output + '\n', 'utf-8');
      console.error(`Report written to ${ctx.values.output}`);
    } else {
      console.log(output);
    }

    for (const hint of formatActionHints(verifyResult)) {
      console.error(hint);
    }

    if (verifyResult.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
