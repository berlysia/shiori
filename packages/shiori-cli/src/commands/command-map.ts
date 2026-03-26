/**
 * CLI subcommand registration map (ADR 030).
 *
 * This module is classified as CLI-registration infrastructure, not command
 * pure-logic.  It is therefore exempt from the "commands-no-import-cli-wrappers"
 * boundary rule — importing every *-cli.ts wrapper is its sole purpose.
 *
 * cli.ts imports subCommandMap from here.
 * CLI_SUBCOMMAND_KEYS is test-only: three-way consistency is verified in
 * exit-codes.test.ts and doctor.test.ts, not at runtime.
 */
import { scanCommand } from './scan-cli.ts';
import { verifyCommand } from './verify-cli.ts';
import { checkCommand } from './check-cli.ts';
import { initCommand } from './init-cli.ts';
import { updateCommand } from './update-cli.ts';
import { draftCommand } from './draft-cli.ts';
import { candidatesCommand } from './candidates-cli.ts';
import { showCommand } from './show-cli.ts';
import { docsCommand } from './docs-cli.ts';
import { jumpCommand } from './jump-cli.ts';
import { watchCommand } from './watch-cli.ts';
import { migrateCommand } from './migrate-cli.ts';
import { reportCommand } from './report-cli.ts';
import { deltaCommand } from './delta-cli.ts';
import { trendCommand } from './trend-cli.ts';
import { healthCommand } from './health-cli.ts';
import { adoptCommand } from './adopt-cli.ts';
import { doctorCommand } from './doctor-cli.ts';
import { resolveCommand } from './resolve-cli.ts';
import { whyCommand } from './why-cli.ts';
import { triageCommand } from './triage-cli.ts';
import { annotateCommand } from './annotate-cli.ts';
import { weeklyReportCommand } from './weekly-report-cli.ts';
import { journalCommand } from './journal-cli.ts';
import { summaryCommand } from './summary-cli.ts';
import { aggregateCommand } from './aggregate-cli.ts';
import { guideCommand } from './guide-cli.ts';
import { fixCommand } from './fix-cli.ts';
import { coachCommand } from './coach-cli.ts';
import { narrativeCommand } from './narrative-cli.ts';
import { recipesCommand } from './recipes-cli.ts';
import { pitchCommand } from './pitch-cli.ts';
import { onboardCommand } from './onboard-cli.ts';

/**
 * All CLI subcommand registrations.
 * Keys must stay in sync with REGISTERED_COMMANDS and EXIT_CODE_POLICIES.
 * Three-way consistency is verified by tests (exit-codes.test.ts, doctor.test.ts).
 */
export const subCommandMap = {
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
  'weekly-report': weeklyReportCommand,
  journal: journalCommand,
  summary: summaryCommand,
  aggregate: aggregateCommand,
  guide: guideCommand,
  fix: fixCommand,
  coach: coachCommand,
  narrative: narrativeCommand,
  recipes: recipesCommand,
  pitch: pitchCommand,
  onboard: onboardCommand,
} as const;

/**
 * CLI subcommand keys — test-only export.
 * Used by exit-codes.test.ts and doctor.test.ts for three-way consistency
 * (REGISTERED_COMMANDS ↔ EXIT_CODE_POLICIES ↔ CLI_SUBCOMMAND_KEYS).
 */
export const CLI_SUBCOMMAND_KEYS: readonly string[] =
  Object.keys(subCommandMap);
