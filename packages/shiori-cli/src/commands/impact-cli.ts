import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { verify } from './verify.ts';
import { computeImpact, formatImpact, IMPACT_FORMATS } from './impact.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { ExitCode } from '../core/exit-codes.ts';
import type { ImpactFormat } from '../core/types.ts';

const validateImpactFormat =
  createFormatValidator<ImpactFormat>(IMPACT_FORMATS);

export const impactCommand = define({
  name: 'impact',
  description:
    "Show a specific owner's Coverage/Hygiene contribution and improvement prescriptions (EP-0200)",
  examples: `  # Show impact for owner "alice"
  shiori impact --owner alice

  # Markdown output
  shiori impact --owner alice --format markdown

  # JSON output to file
  shiori impact --owner alice -f json -o impact.json`,
  rendering: { header: null },
  args: {
    owner: {
      type: 'string',
      description: 'Owner name to analyze (required)',
      required: true,
    },
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
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json", "markdown". Default: "json"',
      default: 'json',
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
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Overrides config. Default: 14',
    },
  },
  run: async (ctx) => {
    const format = validateImpactFormat(ctx.values.format);
    if (format === null) return;

    const owner = ctx.values.owner;
    if (!owner) {
      console.error('Error: --owner is required.');
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    const base = createBaseContext(ctx.values.cwd);
    const regCtx = await withRegistry(base, {
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    const { patterns, ignore } = resolveScanPatterns(
      ctx.values.patterns,
      ctx.values.ignore,
      regCtx.config,
    );

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
      cwd: base.cwd,
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Verify
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );
    const verifyResult = verify({
      records: scanResult.annotations,
      registry: regCtx.registry,
      failOn: [],
      warnOn: [],
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    // Check owner exists in registry
    const ownerRefs = Object.entries(regCtx.registry).filter(
      ([, e]) => e.owner === owner,
    );
    if (ownerRefs.length === 0) {
      console.error(`Error: No registry entries found for owner "${owner}".`);
      // Show available owners
      const owners = new Set<string>();
      for (const entry of Object.values(regCtx.registry)) {
        if (entry.owner) owners.add(entry.owner);
      }
      if (owners.size > 0) {
        console.error(`Available owners: ${[...owners].sort().join(', ')}`);
      }
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Compute impact
    const result = computeImpact({
      owner,
      scanResult,
      registry: regCtx.registry,
      verifyResult,
    });

    console.error(
      `Owner "${owner}": ${result.annotationCount} annotation(s), Coverage ${result.coverage}/100, Hygiene ${result.hygiene}/100`,
    );

    const output = formatImpact(result, format);
    await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Impact report',
    });
  },
});
