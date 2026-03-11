#!/usr/bin/env node
/**
 * Build shiori playground bundle for browser use.
 * Outputs: playground/shiori-playground.js (~10-20KB)
 */
import { build } from 'esbuild';
import { mkdirSync, cpSync } from 'node:fs';

const outdir = 'playground';
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: ['src/playground/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: `${outdir}/shiori-playground.js`,
  minify: true,
  sourcemap: true,
  metafile: true,
  // No Node.js dependencies should be needed
  platform: 'browser',
});

// Copy HTML page
cpSync('src/playground/index.html', `${outdir}/index.html`);

// Report bundle size
const outputs = result.metafile.outputs;
for (const [file, meta] of Object.entries(outputs)) {
  if (file.endsWith('.js')) {
    const kb = (meta.bytes / 1024).toFixed(1);
    console.log(`✓ ${file}: ${kb} KB`);
  }
}
