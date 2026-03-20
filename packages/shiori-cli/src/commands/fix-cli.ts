import { define } from "gunshi";
import { scan } from "./scan.ts";
import { CommentProvider } from "../core/providers/CommentProvider.ts";
import { report } from "./report.ts";
import { buildHealthResult } from "./health.ts";
import { parseAndValidateIssueTypes, createFormatValidator } from "../core/cli-validation.ts";
import {
  createBaseContext,
  withRegistry,
  saveRegistryRouted,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from "../core/cli-context.ts";
import { initRegistry } from "./registry-generator.ts";
import { recordJournalEvent } from "../core/journal.ts";
import { ExitCode } from "../core/exit-codes.ts";
import {
  planFixActions,
  formatFixPlan,
  formatFixPlanJson,
  formatFixApplyResult,
  formatFixApplyResultJson,
  type FixApplyResult,
} from "./fix.ts";

/** Output format for fix command */
type FixFormat = "text" | "json";

const validateFixFormat = createFormatValidator<FixFormat>(["text", "json"] as const, "text");

export const fixCommand = define({
  name: "fix",
  description: "Auto-fix governance issues (unified remediation command)",
  examples: `  # Dry-run: show what would be fixed
  shiori fix

  # Execute fixes
  shiori fix --apply

  # JSON output for CI integration
  shiori fix --format json

  # Execute with JSON output
  shiori fix --apply --format json`,
  rendering: { header: null },
  args: {
    patterns: {
      type: "string",
      short: "p",
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: "string",
      short: "i",
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    registry: {
      type: "string",
      short: "r",
      description:
        "Path to registry file (auto-detected from config or .config/shiori/registry.json)",
    },
    failOn: {
      type: "string",
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "expired,missing-in-registry"',
    },
    warnOn: {
      type: "string",
      toKebab: true,
      description: 'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
    format: {
      type: "string",
      short: "f",
      description: 'Output format: "text", "json". Default: "text"',
      default: "text",
    },
    apply: {
      type: "boolean",
      short: "a",
      description: "Execute fixes (default: dry-run preview)",
    },
    cwd: {
      type: "string",
      description: "Working directory. Default: process.cwd()",
    },
    config: {
      type: "string",
      short: "c",
      description:
        "Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori",
    },
    expiringThreshold: {
      type: "string",
      toKebab: true,
      description:
        "Days before expiration to trigger expiring-soon warning. Overrides config. Default: 14",
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, "--fail-on");
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, "--warn-on");
    if (warnOn === null) return;

    const format = validateFixFormat(ctx.values.format);
    if (format === null) return;

    // Load context
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

    // Generate report (verify + health score)
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const reportResult = report({
      scanResult,
      registry: regCtx.registry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    // Plan fix actions
    const plan = planFixActions(reportResult);

    // Dry-run mode (default)
    if (!ctx.values.apply) {
      if (format === "json") {
        console.log(formatFixPlanJson(plan));
      } else {
        console.error(formatFixPlan(plan));
      }
      return;
    }

    // Apply mode
    if (plan.actions.length === 0) {
      if (format === "json") {
        console.log(formatFixPlanJson(plan));
      } else {
        console.error("No automatable fix actions to apply.");
        if (plan.manualSuggestions.length > 0) {
          console.error("");
          console.error("📋 Manual actions (not automatable):");
          for (const suggestion of plan.manualSuggestions) {
            console.error(`  - ${suggestion.command}: ${suggestion.message}`);
          }
        }
      }
      return;
    }

    // Execute update action
    const beforeResult = buildHealthResult(reportResult);
    const beforeScore = beforeResult.health.score;

    const updatedRegistry = initRegistry({
      records: scanResult.annotations,
      existingRegistry: regCtx.registry,
    });

    // Count new entries
    const newRefs = Object.keys(updatedRegistry).filter((ref) => !(ref in regCtx.registry));

    if (newRefs.length === 0) {
      if (format === "json") {
        const result: FixApplyResult = {
          applied: [],
          registryChanges: { added: [] },
          scoreBefore: beforeScore,
          scoreAfter: beforeScore,
        };
        console.log(formatFixApplyResultJson(result));
      } else {
        console.error("Registry is already up to date (no new refs to add).");
      }
      return;
    }

    // Save registry
    const saved = await saveRegistryRouted({
      registry: updatedRegistry,
      registryPath: regCtx.registryPath,
      cwd: base.cwd,
      refPatterns: regCtx.config.refPatterns,
      label: "Fixed",
    });

    if (!saved) {
      console.error("Error: Registry save failed (path boundary error).");
      process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
      return;
    }

    // Journal event
    recordJournalEvent({
      cwd: base.cwd,
      eventType: "cli.fix",
      refs: newRefs,
      success: true,
      entriesAdded: newRefs.length,
    });

    // Re-run report to get after score
    const afterReportResult = report({
      scanResult,
      registry: updatedRegistry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });
    const afterResult = buildHealthResult(afterReportResult);
    const afterScore = afterResult.health.score;

    // Build applied actions from actual newRefs (not plan.actions.refs)
    // because initRegistry filters via isValidRef — some plan refs may be skipped.
    const appliedAction = {
      type: "update" as const,
      description: `Added ${newRefs.length} ref(s) to registry`,
      refs: newRefs,
    };

    const fixResult: FixApplyResult = {
      applied: [appliedAction],
      registryChanges: { added: newRefs },
      scoreBefore: beforeScore,
      scoreAfter: afterScore,
    };

    if (format === "json") {
      console.log(formatFixApplyResultJson(fixResult));
    } else {
      console.error(formatFixApplyResult(fixResult));
    }
  },
});
