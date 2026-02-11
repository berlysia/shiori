import { define } from 'gunshi';
import { writeFile } from 'node:fs/promises';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';

const DEFAULT_PATTERNS = ['**/*.{css,scss,pcss,js,ts,tsx,jsx}'];
const DEFAULT_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

export const scanCommand = define({
  name: 'scan',
  description: 'Scan source files for shiori annotations',
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
      description: 'Output file path. If omitted, writes to stdout',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    provider: {
      type: 'string',
      description: 'Annotation provider. Default: "comment"',
      default: 'comment',
    },
  },
  run: async (ctx) => {
    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : DEFAULT_PATTERNS;

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : DEFAULT_IGNORE;

    const cwd = ctx.values.cwd ?? process.cwd();
    const provider = new CommentProvider();

    const result = await scan({ patterns, ignore, provider, cwd });
    const json = JSON.stringify(result.records, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, json + '\n', 'utf-8');
      console.error(
        `Wrote ${result.records.length} records to ${ctx.values.output}`,
      );
    } else {
      console.log(json);
    }

    console.error(
      `Scanned ${result.filesScanned} files, found ${result.records.length} annotation(s)`,
    );
  },
});
