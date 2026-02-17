#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { scanCommand } from './commands/scan-cli.ts';
import { verifyCommand } from './commands/verify-cli.ts';
import { checkCommand } from './commands/check-cli.ts';
import { initCommand } from './commands/init-cli.ts';
import { updateCommand } from './commands/update-cli.ts';
import { draftCommand } from './commands/draft-cli.ts';
import { candidatesCommand } from './commands/candidates-cli.ts';
import { showCommand } from './commands/show-cli.ts';
import { docsCommand } from './commands/docs-cli.ts';
import { jumpCommand } from './commands/jump-cli.ts';
import { watchCommand } from './commands/watch-cli.ts';

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
  shiori update                  Add new refs to the registry
  shiori watch                   Refresh scan result on each save
  shiori check --fail-on ...     Enforce governance in CI

Other commands:
  shiori scan                    Extract annotations from source
  shiori verify                  Verify scan results against registry
  shiori show --ref <ref>        Look up a specific ref
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
    version: '0.0.1',
    description: 'Track and govern source code annotations',
    subCommands: {
      init: initCommand,
      scan: scanCommand,
      verify: verifyCommand,
      check: checkCommand,
      update: updateCommand,
      draft: draftCommand,
      candidates: candidatesCommand,
      show: showCommand,
      jump: jumpCommand,
      watch: watchCommand,
      docs: docsCommand,
    },
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
