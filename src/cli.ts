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
  shiori scan && shiori update`,
  run: () => {
    console.log('Run "shiori --help" for usage information.');
  },
});

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
    docs: docsCommand,
  },
});
