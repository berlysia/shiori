/**
 * CLI wrapper for the coach command (EP-0139).
 *
 * Generates structured LLM prompts from governance data.
 * Internally runs triage, weekly-report, and/or health to collect JSON,
 * then embeds it into prompt templates. No LLM API calls.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { report } from './report.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { triage, formatTriageOutput } from './triage.ts';
import { buildHealthResult } from './health.ts';
import { formatHealth } from './health-cli.ts';
import { readJournalEntries, resolveJournalPath } from '../core/journal.ts';
import { computeJournalVelocity } from './journal-velocity.ts';
import {
  collectReportData,
  analyzeReportData,
} from '../core/report-generator.ts';
import { formatWeeklyReport } from '../formatters/weekly-report-html-formatter.ts';
import {
  buildCoachPrompt,
  buildCoachPromptFromCustomTemplate,
  formatCoachOutput,
  COACH_TEMPLATES,
  COACH_FORMATS,
  type CoachTemplate,
  type CoachFormat,
} from './coach.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { resolveExpiringThreshold } from '../core/cli-context.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { ExitCode } from '../core/exit-codes.ts';

const validateCoachFormat = createFormatValidator<CoachFormat>(
  COACH_FORMATS,
  'prompt',
);

const VALID_TEMPLATES: readonly string[] = COACH_TEMPLATES;

export const coachCommand = define({
  name: 'coach',
  description:
    'Generate structured LLM prompts from governance data for coaching advice',
  examples: `  # Generate a triage advisor prompt (default)
  shiori coach

  # Weekly report coach prompt
  shiori coach --template weekly

  # Health diagnosis prompt
  shiori coach --template health

  # Combined triage + weekly prompt
  shiori coach --template combined

  # JSON output for automation
  shiori coach -f json

  # GitHub Issue body format
  shiori coach -f github-issue

  # Use custom template file
  shiori coach --template-file ./my-prompt.md

  # Save to file
  shiori coach -o coach-prompt.md`,
  rendering: { header: null },
  args: {
    template: {
      type: 'string',
      short: 't',
      description:
        'Prompt template: "triage", "weekly", "health", "combined". Default: "triage"',
      default: 'triage',
    },
    templateFile: {
      type: 'string',
      toKebab: true,
      description:
        'Path to a custom template file. Overrides --template. Supports {{TRIAGE_JSON}}, {{WEEKLY_REPORT_JSON}}, {{HEALTH_JSON}} placeholders.',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "prompt" (raw text), "json" (structured), "github-issue" (collapsible). Default: "prompt"',
      default: 'prompt',
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
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Default: 14',
    },
  },
  run: async (ctx) => {
    // Validate format
    const format = validateCoachFormat(ctx.values.format);
    if (format === null) return;

    // Validate template (when no custom template file)
    const templateValue = ctx.values.template as string;
    if (!ctx.values.templateFile) {
      if (!VALID_TEMPLATES.includes(templateValue)) {
        console.error(
          `Error: Invalid --template value "${templateValue}". Valid values: ${COACH_TEMPLATES.join(', ')}`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }
    const template = templateValue as Exclude<CoachTemplate, 'custom'>;

    const cwd = ctx.values.cwd ?? process.cwd();

    // Load config and registry
    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry, duplicates, refOrigins } = configAndRegistry;

    const patterns = config.scanPatterns ?? DEFAULT_SCAN_PATTERNS;
    const ignore = [...DEFAULT_SCAN_IGNORE, ...(config.scanIgnore ?? [])];

    // Scan source files
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      config,
    );

    // Generate governance data as JSON strings
    const reportResult = report({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });

    // Triage JSON
    const triageResult = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });
    const triageJson = formatTriageOutput(triageResult, 'json');

    // Health JSON
    const healthResult = buildHealthResult(reportResult);
    const healthJson = formatHealth(healthResult, 'json');

    // Weekly report JSON
    const journalPath = resolveJournalPath(cwd);
    const journalEntries = journalPath
      ? readJournalEntries(journalPath, {
          onReadError: (msg) => console.error(`Warning: ${msg}`),
          onSkipped: (count) =>
            console.error(
              `Warning: ${count} malformed journal entry(ies) skipped`,
            ),
        })
      : [];
    const velocity = computeJournalVelocity(journalEntries);
    const collected = collectReportData({
      journalEntries,
      registry,
      reportResult,
      velocity,
      preset: 'weekly',
    });
    const metrics = analyzeReportData(collected);
    const weeklyReportJson = formatWeeklyReport(metrics, 'json', 'weekly');

    // Build coach prompt
    let result;
    if (ctx.values.templateFile) {
      const templatePath = resolve(cwd, ctx.values.templateFile);
      try {
        await assertWithinCwd(templatePath, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }
      let templateContent: string;
      try {
        templateContent = await readFile(templatePath, 'utf-8');
      } catch {
        console.error(
          `Error: Cannot read template file "${ctx.values.templateFile}"`,
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
      result = buildCoachPromptFromCustomTemplate(templateContent, {
        triageJson,
        weeklyReportJson,
        healthJson,
      });
    } else {
      result = buildCoachPrompt(template, {
        triageJson,
        weeklyReportJson,
        healthJson,
      });
    }

    // Output
    const output = formatCoachOutput(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Coach prompt',
    });
    if (!written) return;

    // Summary on stderr
    console.error(`Coach: template=${result.template}, format=${format}`);
  },
});
