import { define } from 'gunshi';
import { watch as watchFs } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { loadConfig, resolveRegistryPath } from '../core/config.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { loadMultiRegistry, saveRegistry } from '../core/registry.ts';
import { scan } from './scan.ts';
import { initRegistry, routeRegistryByPattern } from './registry-generator.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim());
}

function asRelativeNormalized(cwd: string, filePath: string): string {
  const rel = relative(cwd, resolve(cwd, filePath));
  return rel.split(sep).join('/');
}

function now(): string {
  return new Date().toISOString();
}

export const watchCommand = define({
  name: 'watch',
  description: 'Watch files and refresh scan result on each save',
  examples: `  # Watch and keep scan result fresh
  shiori watch

  # Also sync registry on each refresh
  shiori watch --sync-registry

  # Run one refresh and exit (for scripts/CI)
  shiori watch --once`,
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
        'Output scan-result path. Default: config.paths.scanResult (.config/shiori/scan-result.json)',
    },
    syncRegistry: {
      type: 'boolean',
      toKebab: true,
      description: 'Also merge refs into registry on each refresh',
    },
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (used only with --sync-registry, otherwise ignored)',
    },
    debounceMs: {
      type: 'string',
      toKebab: true,
      description: 'Debounce interval in milliseconds. Default: 250',
    },
    once: {
      type: 'boolean',
      description: 'Run one refresh and exit (no watcher)',
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
    const provider = new CommentProvider();

    const patterns = parseList(
      ctx.values.patterns,
      config.scanPatterns ?? DEFAULT_SCAN_PATTERNS,
    );
    const ignore = parseList(
      ctx.values.ignore,
      config.scanIgnore ?? DEFAULT_SCAN_IGNORE,
    );

    const outputPath = resolve(
      cwd,
      ctx.values.output ?? config.paths.scanResult,
    );
    const outputRel = asRelativeNormalized(cwd, outputPath);

    const debounceMsRaw = ctx.values.debounceMs ?? '250';
    const debounceMs = Number.parseInt(debounceMsRaw, 10);
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new Error(`Invalid --debounce-ms value: ${debounceMsRaw}`);
    }

    const syncRegistry = Boolean(ctx.values.syncRegistry);
    const registryPath = syncRegistry
      ? await resolveRegistryPath(ctx.values.registry, config, cwd)
      : undefined;
    const registryRel = registryPath
      ? asRelativeNormalized(cwd, registryPath)
      : undefined;

    let ignoreEventsUntil = 0;

    const refresh = async (reason: string): Promise<void> => {
      const result = await scan({
        patterns,
        ignore,
        provider,
        cwd,
        providerOptions: { candidatePatterns: config.candidatePatterns },
      });

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        JSON.stringify(result, null, 2) + '\n',
        'utf-8',
      );

      if (syncRegistry && registryPath) {
        const { registry: existingRegistry } = await loadMultiRegistry(
          registryPath,
          config.refPatterns,
        );
        const merged = initRegistry({
          records: result.annotations,
          existingRegistry,
        });
        const newRefs = Object.keys(merged).filter(
          (ref) => !(ref in existingRegistry),
        );

        if (config.refPatterns) {
          const routed = routeRegistryByPattern(merged, config.refPatterns);
          const basePath = dirname(resolve(registryPath));

          for (const [target, entries] of routed) {
            if (target === null) {
              await saveRegistry(registryPath, entries);
            } else {
              await saveRegistry(resolve(basePath, target), entries);
            }
          }
        } else {
          await saveRegistry(registryPath, merged);
        }

        if (newRefs.length > 0) {
          console.error(
            `[${now()}] refreshed (${reason}) - annotations=${result.annotations.length} candidates=${result.candidates.length} new-refs=${newRefs.length}`,
          );
        } else {
          console.error(
            `[${now()}] refreshed (${reason}) - annotations=${result.annotations.length} candidates=${result.candidates.length} registry=up-to-date`,
          );
        }
      } else {
        console.error(
          `[${now()}] refreshed (${reason}) - annotations=${result.annotations.length} candidates=${result.candidates.length}`,
        );
      }

      ignoreEventsUntil = Date.now() + Math.max(300, debounceMs);
    };

    await refresh('initial');
    if (ctx.values.once) {
      console.error(`Saved scan result to ${outputRel}`);
      return;
    }

    console.error(
      `Watching ${cwd} (recursive). Writing scan result to ${outputRel}`,
    );
    if (registryRel) {
      console.error(`Registry sync enabled: ${registryRel}`);
    }

    await new Promise<void>((resolvePromise) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watcher = watchFs(
        cwd,
        { recursive: true },
        (_eventType, filename) => {
          if (Date.now() < ignoreEventsUntil) return;

          const changed = typeof filename === 'string' ? filename : '';
          const normalized = changed.split(sep).join('/');
          if (normalized !== '') {
            if (normalized === outputRel) return;
            if (registryRel && normalized === registryRel) return;
          }

          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            void refresh(normalized === '' ? 'fs-event' : normalized).catch(
              (err: unknown) => {
                const message =
                  err instanceof Error
                    ? (err.stack ?? err.message)
                    : String(err);
                console.error(message);
              },
            );
          }, debounceMs);
        },
      );

      const shutdown = (): void => {
        if (timer) clearTimeout(timer);
        watcher.close();
        resolvePromise();
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  },
});
