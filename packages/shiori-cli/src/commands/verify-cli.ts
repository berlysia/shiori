import { define } from 'gunshi';
import { verify, formatActionHints } from './verify.ts';
import { formatVerifyOutput } from '../formatters/index.ts';
import {
  parseAndValidateIssueTypes,
  validateOutputFormat,
} from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  createBaseContext,
  withRegistry,
  withScanResult,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { resolveRefStatusMap } from '../core/ref-status-providers/index.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { formatOnboardingGuidance } from '../core/onboarding-guidance.ts';

export const verifyCommand = define({
  name: 'verify',
  description: 'Verify annotations against the registry',
  examples: `  # Verify with auto-detected scan result and registry
  shiori verify --fail-on missing-in-registry,expired

  # Pipe from scan
  shiori scan | shiori verify --fail-on expired

  # Explicit paths
  shiori verify -s scan-result.json -r registry.json --fail-on expired

  # Markdown report
  shiori verify -f markdown -o report.md`,
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
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
        'Output format: "json", "markdown", "sarif", "summary", "jsonl", "diagnostic". Default: "json"',
      default: 'json',
    },
    failOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "missing-in-registry,expired"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
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
    refStatusCommand: {
      type: 'string',
      toKebab: true,
      description:
        'External command to check ref statuses. Receives refs on stdin (newline-delimited), returns JSONL with {ref, status} on stdout. Note: command path must not contain spaces',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;
    const format = validateOutputFormat(ctx.values.format);
    if (format === null) return;

    const base = createBaseContext(ctx.values.cwd);
    const regCtx = await withRegistry(base, {
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    const { scanResult } = await withScanResult(regCtx, ctx.values.scan);

    // Resolve ref statuses via provider (user command or auto-detected GitHub)
    const { refStatuses } = await resolveRefStatusMap(
      {
        refStatusCommand: ctx.values.refStatusCommand,
        githubToken: process.env.GITHUB_TOKEN,
        githubRepository: process.env.GITHUB_REPOSITORY,
      },
      scanResult.annotations,
    );

    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const result = verify({
      records: scanResult.annotations,
      registry: regCtx.registry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
      refStatuses,
    });

    const output = formatVerifyOutput({
      format,
      verifyResult: result,
      annotations: scanResult.annotations,
      candidates: [],
      registry: regCtx.registry,
    });

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Report',
    });
    if (!written) return;

    for (const hint of formatActionHints(result)) {
      console.error(hint);
    }

    // Onboarding guidance for initial setup state (EP-0127)
    const uniqueRefs = new Set(scanResult.annotations.map((a) => a.ref));
    for (const line of formatOnboardingGuidance({
      context: {
        totalUniqueRefs: uniqueRefs.size,
        missingInRegistryCount: result.summary.byType['missing-in-registry'],
      },
      format,
      isTTY: process.stderr.isTTY ?? false,
    })) {
      console.error(line);
    }

    if (result.summary.errors > 0) {
      process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
    }
  },
});
