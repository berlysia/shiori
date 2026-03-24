import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function findPackageRoot(startDir: string): Promise<string> {
  let dir = startDir;
  for (;;) {
    try {
      await readFile(resolve(dir, 'package.json'), 'utf-8');
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return null as unknown as string;
      }
      dir = parent;
    }
  }
}

const DOCS_URL =
  'https://raw.githubusercontent.com/berlysia/shiori/main/README.md';

export const docsCommand = define({
  name: 'docs',
  description: 'Show documentation (README)',
  examples: `  # Show README
  shiori docs`,
  rendering: { header: null },
  args: {},
  run: async () => {
    // Try local README first (works in development and npm installs)
    const currentDir =
      typeof import.meta.dirname === 'string'
        ? import.meta.dirname
        : dirname(fileURLToPath(import.meta.url));
    const packageRoot = await findPackageRoot(currentDir);
    if (packageRoot) {
      const readmePath = resolve(packageRoot, 'README.md');
      try {
        const content = await readFile(readmePath, 'utf-8');
        console.log(content);
        return;
      } catch {
        // fall through to remote fetch
      }
    }

    // Fallback: fetch from GitHub (standalone/mise installs)
    const res = await fetch(DOCS_URL);
    if (!res.ok) {
      console.error(
        'Could not load documentation. View online: https://github.com/berlysia/shiori#readme',
      );
      process.exitCode = 1;
      return;
    }
    console.log(await res.text());
  },
});
