import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfigAndRegistry } from '../core/registry-loader.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { saveRegistryRouted } from '../core/cli-context.ts';
import { recordJournalEvent } from '../core/journal.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import type { AnnotateFormat } from '../core/types.ts';
import { isValidRef } from './registry-generator.ts';
import {
  planAnnotation,
  formatAnnotatePreview,
  AnnotateError,
} from './annotate.ts';
import { formatAnnotateAsJson } from '../formatters/annotate-formatter.ts';

const validateAnnotateFormat = createFormatValidator<AnnotateFormat>(
  ['text', 'json'] as const,
  'text',
);

/**
 * Parse --target flag value into file path and line number.
 * Expected format: `<file>:<line>` where line is a positive integer.
 */
function parseTarget(target: string): { file: string; line: number } {
  const lastColon = target.lastIndexOf(':');
  if (lastColon <= 0) {
    throw new AnnotateError(
      `Invalid --target format "${target}". Expected <file>:<line>`,
    );
  }
  const file = target.slice(0, lastColon);
  const lineStr = target.slice(lastColon + 1);
  const line = parseInt(lineStr, 10);
  if (!Number.isFinite(line) || line < 1) {
    throw new AnnotateError(
      `Invalid --target format "${target}". Line must be a positive integer.`,
    );
  }
  return { file, line };
}

export const annotateCommand = define({
  name: 'annotate',
  description:
    'Insert a shiori annotation into a source file and add a registry entry',
  examples: `  # Preview annotation insertion (dry-run, default)
  shiori annotate --target src/app.ts:10 --ref SUP-1234

  # Apply annotation (write to file + registry)
  shiori annotate --target src/app.ts:10 --ref SUP-1234 --apply

  # With reason and expiration
  shiori annotate --target src/app.ts:10 --ref SUP-1234 --reason "workaround for issue" --expires 2026-06 --apply

  # With custom kind (registry-only)
  shiori annotate --target src/app.ts:10 --ref ADR:0007 --kind decision --apply

  # JSON output for editor integration
  shiori annotate --target src/app.ts:10 --ref SUP-1234 --format json

  # JSON output to file
  shiori annotate --target src/app.ts:10 --ref SUP-1234 --format json --output result.json`,
  rendering: { header: null },
  args: {
    target: {
      type: 'string',
      short: 't',
      description: 'Target location as <file>:<line> (required)',
      required: true,
    },
    ref: {
      type: 'string',
      short: 'r',
      description: 'Tracking reference (e.g. "SUP-1234") (required)',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason text for registry entry',
    },
    expires: {
      type: 'string',
      description: 'Expiration date (YYYY-MM-DD or YYYY-MM)',
    },
    kind: {
      type: 'string',
      description:
        'Kind for registry entry (default: "annotation"). Registry-only, not in source comment.',
    },
    apply: {
      type: 'boolean',
      short: 'a',
      description:
        'Actually write changes to source file and registry (default: dry-run preview)',
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
    registry: {
      type: 'string',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "text" (human-readable, default) or "json" (structured for editor integration)',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Write output to file instead of stdout',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const apply = ctx.values.apply ?? false;

    // Validate --format
    const format = validateAnnotateFormat(ctx.values.format);
    if (format === null) return;

    // Parse --target
    const targetValue = ctx.values.target;
    if (!targetValue) {
      console.error('Error: --target is required. Expected <file>:<line>');
      process.exitCode = 1;
      return;
    }

    let file: string;
    let line: number;
    try {
      ({ file, line } = parseTarget(targetValue));
    } catch (err) {
      if (err instanceof AnnotateError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // Parse --ref
    const ref = ctx.values.ref;
    if (!ref) {
      console.error('Error: --ref is required.');
      process.exitCode = 1;
      return;
    }

    // Validate ref format early
    if (!isValidRef(ref)) {
      console.error(
        `Error: Invalid ref "${ref}". Must match pattern: start with uppercase letter, e.g. "SUP-1234", "ADR:0007"`,
      );
      process.exitCode = 1;
      return;
    }

    // Path boundary validation
    try {
      await assertWithinCwd(file, cwd);
    } catch (err) {
      if (err instanceof PathBoundaryError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // Load config and registry
    const {
      config,
      registry: existingRegistry,
      registryPath,
    } = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    // Read target file
    const filePath = resolve(cwd, file);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      console.error(`Error: File not found: ${file}`);
      process.exitCode = 1;
      return;
    }

    // Plan annotation
    let result;
    try {
      result = planAnnotation({
        file,
        line,
        ref,
        reason: ctx.values.reason,
        expires: ctx.values.expires,
        kind: ctx.values.kind,
        content,
        existingRegistry,
      });
    } catch (err) {
      if (err instanceof AnnotateError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    if (!apply) {
      // Dry-run: format and output preview
      const output =
        format === 'json'
          ? formatAnnotateAsJson({ file, line }, result)
          : formatAnnotatePreview({ file, line }, result);
      const written = await writeOutput(output, {
        outputPath: ctx.values.output,
        cwd,
        label: 'Annotate preview',
      });
      if (!written) return;
      if (format === 'text') {
        console.error('');
        console.error(
          'Run with --apply to write changes to source file and registry.',
        );
      }
      return;
    }

    // Apply mode: write source file
    await writeFile(filePath, result.content, 'utf-8');

    // Update registry
    const mergedRegistry = {
      ...existingRegistry,
      [ref]: result.registryEntry,
    };

    const saved = await saveRegistryRouted({
      registry: mergedRegistry,
      registryPath,
      cwd,
      refPatterns: config.refPatterns,
      label: 'Annotated',
    });
    if (!saved) return;

    // Journal: record annotate operation
    recordJournalEvent({
      cwd,
      eventType: 'cli.annotate',
      refs: [ref],
      success: true,
      entriesAdded: 1,
    });

    // Output result (both text and json formats respect --output)
    const output =
      format === 'json'
        ? formatAnnotateAsJson({ file, line }, result)
        : formatAnnotatePreview({ file, line }, result);
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Annotate result',
    });
    if (!written) return;

    // Report success to stderr (always, for both formats)
    console.error(`Annotated ${file}:${line} with ref "${ref}"`);
    if (result.lineInserted) {
      console.error('Inserted new comment line above target line.');
    } else {
      console.error('Appended annotation to existing comment.');
    }
    console.error(`Registry entry added: ${ref}`);

    if (result.warnings.length > 0) {
      console.error('');
      console.error('Warnings:');
      for (const w of result.warnings) {
        console.error(`  ${w}`);
      }
    }
  },
});
