#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { subCommandMap } from './commands/command-map.ts';
import { VERSION } from './core/version.ts';
import { ExitCode } from './core/exit-codes.ts';

const main = define({
  name: 'shiori',
  description: 'Annotation tracking and governance tool',
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
  shiori narrative               Governance narrative from snapshots
  shiori journal                 Browse CLI operation journal
  shiori aggregate               Aggregate multi-repo summaries
  shiori check --fail-on ...     Enforce governance in CI

Adoption:
  shiori pitch                   Generate a governance adoption pitch for your team
  shiori onboard --from-pitch    Generate onboarding steps from pitch report

Coaching:
  shiori coach                   Generate LLM prompts for governance coaching

Diagnostics:
  shiori doctor                  Diagnose shiori setup
  shiori guide                   Interactive command navigator
  shiori recipes                 Maturity-based recipe catalog

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
    name: 'shiori',
    version: VERSION,
    description: 'Track and govern source code annotations',
    subCommands: subCommandMap,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  if (process.env.SHIORI_DEBUG && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = ExitCode.ENVIRONMENT_ERROR;
}
