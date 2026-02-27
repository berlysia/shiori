import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import { listDrafts } from './draft.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';

export const draftCommand = define({
  name: 'draft',
  description: 'List draft annotations (shiori-tagged without ref)',
  examples: `  # List drafts (auto-detect scan result)
  shiori draft

  # Pipe from scan
  shiori scan | shiori draft

  # Save draft list to file
  shiori draft -o drafts.json`,
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
    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);

    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

    const result = listDrafts(scanResult.annotations);
    const json = JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      const outputPath = resolve(cwd, ctx.values.output);
      try {
        await assertWithinCwd(outputPath, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, json + '\n', 'utf-8');
      console.error(`Wrote ${result.count} draft(s) to ${outputPath}`);
    } else {
      console.log(json);
    }

    console.error(`Found ${result.count} draft annotation(s)`);
  },
});
