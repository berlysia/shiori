import { define } from 'gunshi';
import { loadMultiRegistry } from '../core/registry.ts';
import { loadConfig, resolveRegistryPath } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { show, isFound } from './show.ts';

export const showCommand = define({
  name: 'show',
  description: 'Show information about a specific ref',
  examples: `  # Look up a ref (auto-detect scan result and registry)
  shiori show --ref JIRA-123

  # Explicit paths
  shiori show --ref SUP-1234 -s scan-result.json -r registry.json`,
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      required: true,
      description: 'The ref to look up (e.g. "JIRA-123", "SUP-1234")',
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

    const result = show({
      ref: ctx.values.ref,
      registry,
      annotations: scanResult.annotations,
      refPatterns: config.refPatterns,
    });

    console.log(JSON.stringify(result, null, 2));

    if (!isFound(result)) {
      process.exitCode = 1;
    }
  },
});
