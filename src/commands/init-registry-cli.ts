import { define } from 'gunshi';
import { resolve, dirname } from 'node:path';
import { loadRegistry, saveRegistry } from '../core/registry.ts';
import { loadConfig } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { initRegistry, routeRegistryByPattern } from './init-registry.ts';

export const initRegistryCommand = define({
  name: 'init-registry',
  description: 'Generate a registry template from scan results',
  examples: `  # Generate a new registry (auto-detect scan result)
  shiori init-registry -o registry.json

  # Merge with existing registry
  shiori init-registry -o registry.json --merge existing-registry.json

  # Pipe from scan
  shiori scan | shiori init-registry -o registry.json`,
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
    },
    output: {
      type: 'string',
      short: 'o',
      required: true,
      description: 'Output registry file path (.json, .yaml, .yml)',
    },
    merge: {
      type: 'string',
      short: 'm',
      description:
        'Existing registry to merge with (preserves existing entries)',
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

    let existingRegistry;
    if (ctx.values.merge) {
      const { registry } = await loadRegistry(ctx.values.merge);
      existingRegistry = registry;
    }

    const registry = initRegistry({
      records: scanResult.annotations,
      existingRegistry,
    });

    // Route entries by pattern if refPatterns are configured
    if (config.refPatterns) {
      const routed = routeRegistryByPattern(registry, config.refPatterns);
      const basePath = dirname(resolve(ctx.values.output));

      for (const [target, entries] of routed) {
        if (target === null) {
          // Default registry
          await saveRegistry(ctx.values.output, entries);
          console.error(
            `Generated default registry with ${Object.keys(entries).length} entries at ${ctx.values.output}`,
          );
        } else {
          const targetPath = resolve(basePath, target);
          await saveRegistry(targetPath, entries);
          console.error(
            `Generated pattern registry with ${Object.keys(entries).length} entries at ${targetPath}`,
          );
        }
      }
    } else {
      await saveRegistry(ctx.values.output, registry);
      const entryCount = Object.keys(registry).length;
      console.error(
        `Generated registry with ${entryCount} entries at ${ctx.values.output}`,
      );
    }
  },
});
