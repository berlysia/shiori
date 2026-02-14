#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { scanCommand } from './commands/scan-cli.ts';
import { verifyCommand } from './commands/verify-cli.ts';
import { initRegistryCommand } from './commands/init-registry-cli.ts';
import { draftCommand } from './commands/draft-cli.ts';
import { candidatesCommand } from './commands/candidates-cli.ts';
import { showCommand } from './commands/show-cli.ts';
import { checkCommand } from './commands/check-cli.ts';

const main = define({
  name: 'shiori',
  description: 'Annotation tracking and governance tool',
  examples: `  # One-shot scan + verify
  shiori check --fail-on missing-in-registry,expired

  # Two-step with default paths
  shiori scan && shiori verify --fail-on expired

  # Pipe workflow
  shiori scan | shiori verify --fail-on expired

  # Bootstrap a new registry
  shiori scan && shiori init-registry -o registry.json`,
  run: () => {
    console.log('Run "shiori --help" for usage information.');
  },
});

await cli(process.argv.slice(2), main, {
  name: 'shiori',
  version: '0.0.1',
  description: 'Track and govern source code annotations',
  subCommands: {
    scan: scanCommand,
    verify: verifyCommand,
    check: checkCommand,
    'init-registry': initRegistryCommand,
    draft: draftCommand,
    candidates: candidatesCommand,
    show: showCommand,
  },
});
