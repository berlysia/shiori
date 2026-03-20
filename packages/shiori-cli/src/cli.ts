#!/usr/bin/env node
import { cli, define } from "gunshi";
import { scanCommand } from "./commands/scan-cli.ts";
import { verifyCommand } from "./commands/verify-cli.ts";
import { checkCommand } from "./commands/check-cli.ts";
import { initCommand } from "./commands/init-cli.ts";
import { updateCommand } from "./commands/update-cli.ts";
import { draftCommand } from "./commands/draft-cli.ts";
import { candidatesCommand } from "./commands/candidates-cli.ts";
import { showCommand } from "./commands/show-cli.ts";
import { docsCommand } from "./commands/docs-cli.ts";
import { jumpCommand } from "./commands/jump-cli.ts";
import { watchCommand } from "./commands/watch-cli.ts";
import { migrateCommand } from "./commands/migrate-cli.ts";
import { reportCommand } from "./commands/report-cli.ts";
import { deltaCommand } from "./commands/delta-cli.ts";
import { trendCommand } from "./commands/trend-cli.ts";
import { healthCommand } from "./commands/health-cli.ts";
import { adoptCommand } from "./commands/adopt-cli.ts";
import { doctorCommand } from "./commands/doctor-cli.ts";
import { resolveCommand } from "./commands/resolve-cli.ts";
import { whyCommand } from "./commands/why-cli.ts";
import { triageCommand } from "./commands/triage-cli.ts";
import { annotateCommand } from "./commands/annotate-cli.ts";
import { weeklyReportCommand } from "./commands/weekly-report-cli.ts";
import { journalCommand } from "./commands/journal-cli.ts";
import { summaryCommand } from "./commands/summary-cli.ts";
import { aggregateCommand } from "./commands/aggregate-cli.ts";
import { guideCommand } from "./commands/guide-cli.ts";
import { fixCommand } from "./commands/fix-cli.ts";
import { VERSION } from "./core/version.ts";

const main = define({
  name: "shiori",
  description: "Annotation tracking and governance tool",
  examples: `  # Initialize shiori in a project
  shiori init

  # One-shot scan + verify
  shiori check --fail-on missing-in-registry,expired

  # Two-step with default paths
  shiori scan && shiori verify --fail-on expired

  # Pipe workflow
  shiori scan | shiori verify --fail-on expired

  # Add new refs to registry
  shiori scan && shiori update

  # Keep scan-result fresh while editing
  shiori watch`,
  run: () => {
    console.error(`shiori - Annotation tracking and governance tool

Workflow:
  shiori init                    Set up shiori in your project
  shiori check                   Scan and verify against registry
  shiori health                  Quick governance health summary
  shiori summary                 Aggregated governance summary for PR/CI
  shiori triage                  Prioritized action list by ref
  shiori report                  Generate governance health report
  shiori weekly-report            Generate periodic governance report
  shiori trend                   Compare governance scores over time
  shiori fix                     Auto-fix governance issues
  shiori update                  Add new refs to the registry
  shiori adopt                   Adopt existing lint disables into shiori
  shiori annotate --target ...   Insert annotation into source + registry
  shiori resolve --ref <ref>     Remove resolved/expired annotations
  shiori migrate                 Auto-migrate lint disable comments
  shiori watch                   Refresh scan result on each save
  shiori delta                   Compare scan results for PR review
  shiori journal                 Browse CLI operation journal
  shiori aggregate               Aggregate multi-repo summaries
  shiori check --fail-on ...     Enforce governance in CI

Diagnostics:
  shiori doctor                  Diagnose shiori setup
  shiori guide                   Interactive command navigator

Other commands:
  shiori scan                    Extract annotations from source
  shiori verify                  Verify scan results against registry
  shiori show --ref <ref>        Look up a specific ref
  shiori why --ref <ref>         Explain why an annotation exists
  shiori jump --ref <ref>        Print source location as file:line
  shiori candidates              List untracked lint disable comments
  shiori draft                   List annotations without a ref
  shiori docs                    Show full documentation

Run "shiori <command> --help" for details on each command.`);
  },
});

try {
  await cli(process.argv.slice(2), main, {
    name: "shiori",
    version: VERSION,
    description: "Track and govern source code annotations",
    subCommands: {
      init: initCommand,
      scan: scanCommand,
      verify: verifyCommand,
      check: checkCommand,
      update: updateCommand,
      adopt: adoptCommand,
      migrate: migrateCommand,
      draft: draftCommand,
      candidates: candidatesCommand,
      show: showCommand,
      jump: jumpCommand,
      watch: watchCommand,
      health: healthCommand,
      report: reportCommand,
      trend: trendCommand,
      delta: deltaCommand,
      docs: docsCommand,
      doctor: doctorCommand,
      resolve: resolveCommand,
      why: whyCommand,
      triage: triageCommand,
      annotate: annotateCommand,
      "weekly-report": weeklyReportCommand,
      journal: journalCommand,
      summary: summaryCommand,
      aggregate: aggregateCommand,
      guide: guideCommand,
      fix: fixCommand,
    },
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
