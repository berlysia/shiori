import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { scan, formatScanResultForDisplay } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { loadConfig } from '../core/config.ts';
import { validateProvider } from '../core/cli-validation.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';

export const scanCommand = define({
  name: 'scan',
  description: 'Scan source files for shiori annotations',
  examples: `  # Scan and auto-save to .config/shiori/scan-result.json
  shiori scan

  # Pipe to other commands
  shiori scan | shiori verify

  # Scan with custom patterns
  shiori scan -p "src/**/*.{css,scss,ts,tsx}"

  # Explicit output path
  shiori scan -o scan-result.json`,
  rendering: { header: null },
  args: {
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    output: {
      type: 'string',
      short: 'o',
      description:
        'Output file path. If omitted: TTY saves to .config/shiori/scan-result.json, pipe outputs to stdout',
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
    provider: {
      type: 'string',
      description: 'Annotation provider. Default: "comment"',
      default: 'comment',
    },
  },
  run: async (ctx) => {
    // Validate options early
    if (validateProvider(ctx.values.provider) === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);

    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : (config.scanIgnore ?? DEFAULT_SCAN_IGNORE);

    const provider = new CommentProvider();

    // Validate write targets before scanning (fail-fast)
    const writeTarget = ctx.values.output
      ? resolve(cwd, ctx.values.output)
      : process.stdout.isTTY
        ? resolve(cwd, config.paths.scanResult)
        : undefined;

    if (writeTarget) {
      try {
        await assertWithinCwd(writeTarget, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    }

    const result = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });
    const json = JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      // Explicit --output: write to specified path (resolved against cwd)
      const outputPath = resolve(cwd, ctx.values.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, json + '\n', 'utf-8');
      console.error(
        `Wrote ${result.annotations.length} annotation(s) and ${result.candidates.length} candidate(s) to ${outputPath}`,
      );
      console.error(
        `Scanned ${result.filesScanned} files, found ${result.annotations.length} annotation(s), ${result.candidates.length} candidate(s)`,
      );
    } else if (process.stdout.isTTY) {
      // TTY: auto-save + human-readable output to stdout
      const outputPath = resolve(cwd, config.paths.scanResult);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, json + '\n', 'utf-8');
      console.log(formatScanResultForDisplay(result, config.paths.scanResult));
    } else {
      // Pipe/redirect: stdout JSON + stderr stats
      console.log(json);
      console.error(
        `Scanned ${result.filesScanned} files, found ${result.annotations.length} annotation(s), ${result.candidates.length} candidate(s)`,
      );
    }
  },
});
