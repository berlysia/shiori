import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { why, isFound } from './why.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { ExitCode } from '../core/exit-codes.ts';

export const whyCommand = define({
  name: 'why',
  description:
    'Explain why an annotation exists — registry info, source locations, and issues',
  examples: `  # Look up why a ref exists
  shiori why --ref SUP-1234

  # JSON output for scripting
  shiori why --ref ADR:0007 --json`,
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      required: true,
      description: 'The ref to explain (e.g. "SUP-1234", "ADR:0007")',
    },
    json: {
      type: 'boolean',
      description: 'Output raw JSON instead of human-readable summary',
    },
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

    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry } = configAndRegistry;

    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

    const result = why({
      ref: ctx.values.ref,
      registry,
      annotations: scanResult.annotations,
      refPatterns: config.refPatterns,
      expiringThresholdDays: config.verify.expiringThresholdDays,
      duplicates: configAndRegistry.duplicates,
      refOrigins: configAndRegistry.refOrigins,
    });

    if (ctx.values.json) {
      console.log(wrapOutputJson(result, { command: 'why', schemaVersion: 1 }));
    } else {
      for (const line of result.summary) {
        console.error(line);
      }
    }

    if (!isFound(result)) {
      process.exitCode = ExitCode.USAGE_ERROR;
    }
  },
});
