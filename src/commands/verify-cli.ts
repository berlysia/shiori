import { define } from 'gunshi';
import { writeFile } from 'node:fs/promises';
import { loadMultiRegistry } from '../core/registry.ts';
import { loadConfig, resolveRegistryPath } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { verify, formatActionHints } from './verify.ts';
import { formatVerifyOutput } from '../formatters/index.ts';
import {
  parseAndValidateIssueTypes,
  validateOutputFormat,
} from '../core/cli-validation.ts';

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
      description:
        'Output format: "json", "markdown", "sarif", "summary", "jsonl". Default: "json"',
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
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
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
    const {
      registry,
      errors: registryErrors,
      duplicates,
    } = await loadMultiRegistry(registryPath, config.refPatterns);
    if (registryErrors.length > 0) {
      console.error('Registry validation errors:');
      for (const err of registryErrors) {
        console.error(`  ${err.id}: ${err.message}`);
      }
    }
    if (duplicates.length > 0) {
      console.error('Registry duplicate warnings:');
      for (const dup of duplicates) {
        console.error(
          `  ${dup.ref}: found in both ${dup.defaultFile} and ${dup.patternFile}`,
        );
      }
    }

    const result = verify({
      records: scanResult.annotations,
      registry,
      failOn,
      warnOn,
    });

    const output = formatVerifyOutput({
      format,
      verifyResult: result,
      annotations: scanResult.annotations,
      candidates: [],
      registry,
    });

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
