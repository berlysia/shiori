import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import type { ScanResult } from './scan.ts';
import { loadRegistry } from '../core/registry.ts';
import { loadConfig } from '../core/config.ts';
import { show, isFound } from './show.ts';

export const showCommand = define({
  name: 'show',
  description: 'Show information about a specific ref',
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      required: true,
      description: 'The ref to look up (e.g. "JIRA:PROJ-123", "SUP-1234")',
    },
    scan: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to scan result JSON file',
    },
    registry: {
      type: 'string',
      short: 'r',
      required: true,
      description: 'Path to registry file (.json, .yaml, .yml)',
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

    const { registry, errors: registryErrors } = await loadRegistry(
      ctx.values.registry,
    );
    if (registryErrors.length > 0) {
      console.error('Registry validation errors:');
      for (const err of registryErrors) {
        console.error(`  ${err.id}: ${err.message}`);
      }
    }

    const result = show({
      ref: ctx.values.ref,
      registry,
      annotations: scanResult.annotations,
      namespaces: config.namespaces,
    });

    console.log(JSON.stringify(result, null, 2));

    if (!isFound(result)) {
      process.exitCode = 1;
    }
  },
});
