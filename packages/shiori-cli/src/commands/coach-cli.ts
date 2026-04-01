/**
 * CLI wrapper for the coach command (EP-0139, EP-0151).
 *
 * Generates structured LLM prompts from governance data.
 * Internally runs triage, weekly-report, and/or health to collect JSON,
 * then embeds it into prompt templates. No LLM API calls.
 *
 * EP-0151: Optionally computes a governance narrative from report snapshots
 * and embeds it via {{NARRATIVE}} placeholder for richer LLM context.
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
import { formatWeeklyReport } from '../formatters/index.ts';
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
import { isNodeError } from '../core/errors.ts';
import { loadSnapshots } from '../core/snapshot.ts';
import { isReportShape } from '../core/report-files.ts';
import { computeSnapshotDiff } from '../core/diff-snapshots.ts';
import { computeNarrative } from './narrative.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import type { CoachDiffContext, ReportResult } from '../core/types.ts';
import {
  buildCoachDiffContext,
  coachSnapshotFilename,
  deserializeCoachSnapshot,
  serializeCoachSnapshot,
  selectSnapshotsToDelete,
  DEFAULT_MAX_SNAPSHOTS,
} from '../core/coach-diff.ts';

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

  # Slack-compatible Markdown for channel sharing (EP-0212)
  shiori coach -f slack-markdown

  # GitHub Discussion format for team sharing (EP-0212)
  shiori coach -f github-discussion

  # Use custom template file
  shiori coach --template-file ./my-prompt.md

  # Save to file
  shiori coach -o coach-prompt.md

  # Include governance narrative from snapshot history (EP-0151)
  shiori coach --template combined --narrative-history ./reports/

  # Include narrative from specific snapshot files
  shiori coach --template combined --narrative-base old.json --narrative-head new.json

  # Include sprint-over-sprint diff from coach snapshots (EP-0207)
  shiori coach --template health --snapshot-dir .config/shiori/coach-snapshots`,
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
        'Path to a custom template file. Overrides --template. Supports {{TRIAGE_JSON}}, {{WEEKLY_REPORT_JSON}}, {{HEALTH_JSON}}, {{NARRATIVE}}, {{MATURITY_STAGE}}, {{MATURITY_GUIDANCE}} placeholders.',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "prompt" (raw text), "json" (structured), "github-issue" (collapsible), "slack-markdown" (Slack channel), "github-discussion" (Discussion post). Default: "prompt"',
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
    narrativeHistory: {
      type: 'string',
      toKebab: true,
      description:
        'Directory containing ReportResult JSON snapshots for narrative. Uses oldest and newest as base/head.',
    },
    narrativeBase: {
      type: 'string',
      toKebab: true,
      description:
        'Path to the base (before) ReportResult JSON for narrative. Use with --narrative-head.',
    },
    narrativeHead: {
      type: 'string',
      toKebab: true,
      description:
        'Path to the head (after) ReportResult JSON for narrative. Use with --narrative-base.',
    },
    snapshotDir: {
      type: 'string',
      toKebab: true,
      description:
        'Directory for coach snapshots. Loads latest as previous, saves current after prompt generation. Enables sprint-over-sprint diff in templates (EP-0207).',
    },
    maxSnapshots: {
      type: 'string',
      toKebab: true,
      description: `Maximum number of coach snapshots to retain. Oldest files are auto-deleted after saving. Default: ${DEFAULT_MAX_SNAPSHOTS} (EP-0208).`,
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

    // Narrative JSON (EP-0151: optional, from snapshot history or explicit base/head)
    let narrativeJson: string | undefined;
    const hasNarrativeHistory = ctx.values.narrativeHistory !== undefined;
    const hasNarrativeBase = ctx.values.narrativeBase !== undefined;
    const hasNarrativeHead = ctx.values.narrativeHead !== undefined;

    if (hasNarrativeHistory && (hasNarrativeBase || hasNarrativeHead)) {
      console.error(
        'Error: --narrative-history cannot be used together with --narrative-base/--narrative-head',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    if (
      (hasNarrativeBase && !hasNarrativeHead) ||
      (!hasNarrativeBase && hasNarrativeHead)
    ) {
      console.error(
        'Error: --narrative-base and --narrative-head must be used together',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    if (hasNarrativeHistory || (hasNarrativeBase && hasNarrativeHead)) {
      let baseReport: ReportResult;
      let headReport: ReportResult;

      if (hasNarrativeHistory) {
        const reports = await loadSnapshots(ctx.values.narrativeHistory!, cwd, {
          onDirectoryError: (msg) => {
            console.error(`Error: ${msg}`);
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          },
          onNoFiles: (dir) => {
            console.error(`Error: No JSON files found in ${dir}`);
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          },
          onLoaded: (count, dir) => {
            console.error(`Narrative: loaded ${count} snapshot(s) from ${dir}`);
          },
          onSkipped: (file, reason) => {
            console.error(`Warning: Skipped ${file}: ${reason}`);
          },
        });

        if (reports === null) {
          if (!process.exitCode) {
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          }
          return;
        }

        if (reports.length < 2) {
          console.error(
            'Error: At least 2 snapshots are required for narrative',
          );
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        }

        const sorted = [...reports].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        );
        baseReport = sorted[0]!;
        headReport = sorted[sorted.length - 1]!;
      } else {
        // Load explicit base/head
        const basePath = resolve(cwd, ctx.values.narrativeBase!);
        const headPath = resolve(cwd, ctx.values.narrativeHead!);

        try {
          await assertWithinCwd(basePath, cwd);
          await assertWithinCwd(headPath, cwd);
        } catch (err) {
          if (err instanceof PathBoundaryError) {
            console.error(`Error: ${err.message}`);
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
            return;
          }
          throw err;
        }

        try {
          const baseContent = await readFile(basePath, 'utf-8');
          const baseParsed = JSON.parse(baseContent) as Record<string, unknown>;
          if (!isReportShape(baseParsed)) {
            console.error(
              `Error: ${basePath} is not a valid ReportResult JSON`,
            );
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
            return;
          }
          // shiori: DEV-019 reason="runtime JSON shape validated by isReportShape but static type requires assertion"
          baseReport = baseParsed as unknown as ReportResult;
        } catch (err) {
          console.error(
            `Error loading narrative base report: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }

        try {
          const headContent = await readFile(headPath, 'utf-8');
          const headParsed = JSON.parse(headContent) as Record<string, unknown>;
          if (!isReportShape(headParsed)) {
            console.error(
              `Error: ${headPath} is not a valid ReportResult JSON`,
            );
            process.exitCode = ExitCode.ENVIRONMENT_ERROR;
            return;
          }
          // shiori: DEV-019 reason="runtime JSON shape validated by isReportShape but static type requires assertion"
          headReport = headParsed as unknown as ReportResult;
        } catch (err) {
          console.error(
            `Error loading narrative head report: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
      }

      const diff = computeSnapshotDiff(baseReport, headReport);
      const narrative = computeNarrative(diff);
      narrativeJson = wrapOutputJson(narrative, {
        command: 'narrative',
        schemaVersion: 1,
      });
      console.error(
        `Narrative: ${diff.health.baseScore}/100 → ${diff.health.headScore}/100 (${diff.health.direction})`,
      );
    }

    // Build coach diff context (EP-0207: sprint-over-sprint comparison)
    let diffContext: CoachDiffContext | undefined;
    if (ctx.values.snapshotDir) {
      const { readdir, readFile: readFileFs } =
        await import('node:fs/promises');
      const { join, resolve: pathResolve } = await import('node:path');
      const snapshotDirResolved = pathResolve(cwd, ctx.values.snapshotDir);

      try {
        await assertWithinCwd(snapshotDirResolved, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }

      // Load latest previous snapshot
      let previousSnapshot;
      try {
        const files = await readdir(snapshotDirResolved);
        const jsonFiles = files
          .filter((f: string) => f.startsWith('coach-') && f.endsWith('.json'))
          .sort();
        if (jsonFiles.length > 0) {
          const latestFile = join(
            snapshotDirResolved,
            jsonFiles[jsonFiles.length - 1]!,
          );
          const content = await readFileFs(latestFile, 'utf-8');
          previousSnapshot = deserializeCoachSnapshot(content);
          if (previousSnapshot) {
            console.error(
              `Coach diff: loaded previous snapshot from ${jsonFiles[jsonFiles.length - 1]}`,
            );
          } else {
            console.error(
              `Warning: Could not parse ${jsonFiles[jsonFiles.length - 1]} as coach snapshot`,
            );
          }
        } else {
          console.error(
            'Coach diff: no previous snapshots found, creating baseline',
          );
        }
      } catch (err) {
        if (isNodeError(err) && err.code === 'ENOENT') {
          console.error(
            'Coach diff: snapshot directory does not exist, creating baseline',
          );
        } else {
          console.error(
            `Warning: Could not read snapshot directory: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      diffContext = buildCoachDiffContext(healthResult, previousSnapshot);

      // Save current snapshot for next run
      try {
        const { mkdir, writeFile: writeFileFs } =
          await import('node:fs/promises');
        await mkdir(snapshotDirResolved, { recursive: true });
        const filename = coachSnapshotFilename(healthResult.timestamp);
        const snapshotPath = join(snapshotDirResolved, filename);
        await writeFileFs(
          snapshotPath,
          serializeCoachSnapshot(diffContext.current),
          'utf-8',
        );
        console.error(`Coach diff: saved snapshot to ${filename}`);
      } catch (err) {
        console.error(
          `Warning: Could not save coach snapshot: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Auto-rotate old snapshots (EP-0208)
      const maxSnapshotsRaw = ctx.values.maxSnapshots;
      const maxSnapshots =
        maxSnapshotsRaw != null
          ? Number.parseInt(maxSnapshotsRaw, 10)
          : DEFAULT_MAX_SNAPSHOTS;
      if (Number.isNaN(maxSnapshots) || maxSnapshots < 0) {
        console.error(
          `Error: --max-snapshots must be a non-negative integer, got "${maxSnapshotsRaw}"`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      if (maxSnapshots > 0) {
        try {
          const { readdir: readdirFs, unlink } =
            await import('node:fs/promises');
          const allFiles = await readdirFs(snapshotDirResolved);
          const coachFiles = allFiles.filter(
            (f: string) => f.startsWith('coach-') && f.endsWith('.json'),
          );
          const toDelete = selectSnapshotsToDelete(coachFiles, maxSnapshots);
          for (const file of toDelete) {
            await unlink(join(snapshotDirResolved, file));
          }
          if (toDelete.length > 0) {
            console.error(
              `Coach diff: rotated ${toDelete.length} old snapshot(s), retaining ${maxSnapshots}`,
            );
          }
        } catch (err) {
          console.error(
            `Warning: Could not rotate coach snapshots: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Build coach prompt (EP-0205: pass maturityStage, EP-0207: pass diffContext)
    const coachInput = {
      triageJson,
      weeklyReportJson,
      healthJson,
      narrativeJson,
      maturityStage: healthResult.maturityStage,
      diffContext,
    };
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
      } catch (err) {
        if (isNodeError(err) && err.code === 'ENOENT') {
          console.error(
            `Error: Template file not found: "${ctx.values.templateFile}"`,
          );
        } else {
          console.error(
            `Error: Cannot read template file "${ctx.values.templateFile}"`,
          );
        }
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
      result = buildCoachPromptFromCustomTemplate(templateContent, coachInput);
    } else {
      result = buildCoachPrompt(template, coachInput);
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
