import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

async function findPackageRoot(startDir: string): Promise<string> {
  let dir = startDir;
  for (;;) {
    try {
      await readFile(resolve(dir, 'package.json'), 'utf-8');
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        throw new Error('Could not find package root');
      }
      dir = parent;
    }
  }
}

export const docsCommand = define({
  name: 'docs',
  description: 'Show documentation (README)',
  examples: `  # Show README
  shiori docs`,
  rendering: { header: null },
  args: {},
  run: async () => {
    const packageRoot = await findPackageRoot(import.meta.dirname);
    const readmePath = resolve(packageRoot, 'README.md');
    const content = await readFile(readmePath, 'utf-8');
    console.log(content);
  },
});
