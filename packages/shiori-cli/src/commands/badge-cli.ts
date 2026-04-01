import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { buildHealthResult } from './health.ts';
import {
  BADGE_FORMATS,
  BADGE_STYLES,
  formatBadgeOutput,
  type BadgeFormat,
  type BadgeStyle,
} from './badge.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { ExitCode } from '../core/exit-codes.ts';

const validateBadgeFormat = createFormatValidator<BadgeFormat>(
  BADGE_FORMATS,
  'json',
);

export const badgeCommand = define({
  name: 'badge',
  description:
    'Generate a shields.io-compatible governance maturity badge for README embedding',
  examples: `  # Shields.io endpoint JSON (default)
  shiori badge

  # Markdown badge for README
  shiori badge -f markdown

  # Direct URL
  shiori badge -f url

  # Custom style
  shiori badge -f markdown --style for-the-badge

  # Save endpoint JSON for shields.io
  shiori badge -o .tmp/shiori-badge.json`,
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
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "json" (shields.io endpoint), "markdown" (embeddable badge), "url" (direct URL). Default: "json"',
      default: 'json',
    },
    style: {
      type: 'string',
      short: 's',
      description:
        'Badge style: "flat", "flat-square", "plastic", "for-the-badge", "social". Used with markdown/url formats.',
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
    // Validate format
    const format = validateBadgeFormat(ctx.values.format);
    if (format === null) return;

    // Validate style
    let style: BadgeStyle | undefined;
    if (ctx.values.style !== undefined) {
      if (!BADGE_STYLES.includes(ctx.values.style as BadgeStyle)) {
        console.error(
          `Error: Invalid --style value "${ctx.values.style}". Valid values: ${BADGE_STYLES.join(', ')}`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      style = ctx.values.style as BadgeStyle;
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
      cwd: base.cwd,
      providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Build health result (badge derives from maturityStage)
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const reportResult = report({
      scanResult,
      registry: regCtx.registry,
      failOn: [],
      warnOn: [],
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    const healthResult = buildHealthResult(reportResult);

    // Generate badge output
    const output = formatBadgeOutput(healthResult, { format, style });

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Maturity badge',
    });
    if (!written) return;

    // Log maturity stage to stderr for visibility
    const stage = healthResult.maturityStage ?? 'Foundation';
    console.error(
      `🏷️  Maturity: ${stage} (score: ${healthResult.health.score}/100)`,
    );
  },
});
