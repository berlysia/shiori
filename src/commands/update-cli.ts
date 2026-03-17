import { define } from 'gunshi';
import { loadConfigAndRegistry } from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { initRegistry } from './registry-generator.ts';
import { saveRegistryRouted } from '../core/cli-context.ts';

export const updateCommand = define({
  name: 'update',
  description: 'Add new refs from scan results to existing registry',
  examples: `  # Update registry with new refs (auto-detect paths)
  shiori scan && shiori update

  # Pipe from scan
  shiori scan | shiori update

  # Specify registry path
  shiori update -r custom-registry.json`,
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
    'dry-run': {
      type: 'boolean',
      short: 'n',
      description: 'Preview changes without writing to registry',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();

    const {
      config,
      registry: existingRegistry,
      registryPath,
    } = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

    const registry = initRegistry({
      records: scanResult.annotations,
      existingRegistry,
    });

    // Count new entries
    const newRefs = Object.keys(registry).filter(
      (ref) => !(ref in existingRegistry),
    );

    const dryRun = ctx.values['dry-run'] ?? false;

    if (dryRun) {
      if (newRefs.length === 0) {
        console.error('Registry is up to date (no new refs)');
      } else {
        console.error(
          `Would add ${newRefs.length} new ref(s): ${newRefs.join(', ')}`,
        );
      }
      return;
    }

    // Save registry (with path boundary validation and routing)
    const saved = await saveRegistryRouted({
      registry,
      registryPath,
      cwd,
      refPatterns: config.refPatterns,
      label: 'Updated',
    });
    if (!saved) return;

    if (newRefs.length === 0) {
      console.error('Registry is up to date (no new refs)');
    } else {
      console.error(
        `Added ${newRefs.length} new ref(s): ${newRefs.join(', ')}`,
      );
    }
  },
});
