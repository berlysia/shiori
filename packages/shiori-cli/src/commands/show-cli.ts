import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { show, isFound } from './show.ts';
import { ExitCode } from '../core/exit-codes.ts';

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

    const result = show({
      ref: ctx.values.ref,
      registry,
      annotations: scanResult.annotations,
      refPatterns: config.refPatterns,
    });

    console.log(JSON.stringify(result, null, 2));

    if (!isFound(result)) {
      process.exitCode = ExitCode.USAGE_ERROR;
    }
  },
});
