import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import type { ShioriAnnotation } from '../core/types.ts';
import { loadRegistry, saveRegistry } from '../core/registry.ts';
import { initRegistry } from './init-registry.ts';

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
      description: 'Output registry JSON file path',
    },
    merge: {
      type: 'string',
      short: 'm',
      description:
        'Existing registry to merge with (preserves existing entries)',
    },
  },
  run: async (ctx) => {
    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanData = JSON.parse(scanContent) as ShioriAnnotation[];

    let existingRegistry;
    if (ctx.values.merge) {
      const { registry } = await loadRegistry(ctx.values.merge);
      existingRegistry = registry;
    }

    const registry = initRegistry({ records: scanData, existingRegistry });
    await saveRegistry(ctx.values.output, registry);

    const entryCount = Object.keys(registry).length;
    console.error(
      `Generated registry with ${entryCount} entries at ${ctx.values.output}`,
    );
  },
});
