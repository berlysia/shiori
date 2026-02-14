import { define } from 'gunshi';
import { writeFile } from 'node:fs/promises';
import type { VerifyIssueType } from '../core/types.ts';
import { loadRegistry } from '../core/registry.ts';
import { loadConfig, resolveRegistryPath } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import {
  verify,
  formatVerifyResultAsMarkdown,
  formatActionHints,
  type OutputFormat,
} from './verify.ts';

function parseIssueTypes(value: string | undefined): VerifyIssueType[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()) as VerifyIssueType[];
}

export const verifyCommand = define({
  name: 'verify',
  description: 'Verify annotations against the registry',
  examples: `  # Verify with auto-detected scan result and registry
  shiori verify --fail-on missing-in-registry,expired

  # Pipe from scan
  shiori scan | shiori verify --fail-on expired

  # Explicit paths
  shiori verify -s scan-result.json -r registry.json --fail-on expired

  # Markdown report
  shiori verify -f markdown -o report.md`,
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
    },
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json" or "markdown". Default: "json"',
      default: 'json',
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
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
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

    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

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

    const result = verify({
      records: scanResult.annotations,
      registry,
      failOn: parseIssueTypes(ctx.values.failOn),
      warnOn: parseIssueTypes(ctx.values.warnOn),
    });

    const format = (ctx.values.format ?? 'json') as OutputFormat;
    const output =
      format === 'markdown'
        ? formatVerifyResultAsMarkdown(result)
        : JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, output + '\n', 'utf-8');
      console.error(`Report written to ${ctx.values.output}`);
    } else {
      console.log(output);
    }

    for (const hint of formatActionHints(result)) {
      console.error(hint);
    }

    if (result.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
