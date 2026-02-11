import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ScanResult } from './scan.ts';
import { loadRegistry, saveRegistry } from '../core/registry.ts';
import { loadConfig } from '../core/config.ts';
import { initRegistry, routeRegistryByNamespace } from './init-registry.ts';

export const initRegistryCommand = define({
  name: 'init-registry',
  description: 'Generate a registry template from scan results',
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to scan result JSON file',
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
    config: {
      type: 'string',
      short: 'c',
      description: 'Path to directory containing .shiorirc.json. Default: cwd',
    },
  },
  run: async (ctx) => {
    const configDir = ctx.values.config ?? process.cwd();
    const config = await loadConfig(configDir);

    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanResult = JSON.parse(scanContent) as ScanResult;

    let existingRegistry;
    if (ctx.values.merge) {
      const { registry } = await loadRegistry(ctx.values.merge);
      existingRegistry = registry;
    }

    const registry = initRegistry({
      records: scanResult.annotations,
      existingRegistry,
    });

    // Route entries by namespace if namespaces are configured
    if (config.namespaces) {
      const routed = routeRegistryByNamespace(registry, config.namespaces);
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
            `Generated namespace registry with ${Object.keys(entries).length} entries at ${targetPath}`,
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
