import { define } from 'gunshi';
import { loadConfig } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';

function toLocationKey(file: string, line: number): string {
  return `${file}:${line}`;
}

export const jumpCommand = define({
  name: 'jump',
  description: 'Resolve a ref to source location(s) for terminal jump tools',
  examples: `  # Print first location as file:line
  shiori jump --ref SUP-1234

  # Print all locations
  shiori jump --ref SUP-1234 --all`,
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      required: true,
      description: 'The ref to resolve (e.g. "SUP-1234", "JIRA:PROJ-123")',
    },
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
    },
    all: {
      type: 'boolean',
      description: 'Print all matching locations instead of first only',
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

    const seen = new Set<string>();
    const locations = scanResult.annotations
      .filter((a) => a.ref === ctx.values.ref)
      .map((a) => ({ file: a.location.file, line: a.location.line }))
      .filter((loc) => {
        const key = toLocationKey(loc.file, loc.line);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (locations.length === 0) {
      console.error(`No source location found for ref: ${ctx.values.ref}`);
      process.exitCode = 1;
      return;
    }

    if (ctx.values.all) {
      for (const loc of locations) {
        console.log(toLocationKey(loc.file, loc.line));
      }
      return;
    }

    const first = locations[0]!;
    console.log(toLocationKey(first.file, first.line));
  },
});
