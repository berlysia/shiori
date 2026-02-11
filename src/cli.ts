#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { scanCommand } from './commands/scan-cli.ts';
import { verifyCommand } from './commands/verify-cli.ts';
import { initRegistryCommand } from './commands/init-registry-cli.ts';
import { draftCommand } from './commands/draft-cli.ts';
import { candidatesCommand } from './commands/candidates-cli.ts';
import { showCommand } from './commands/show-cli.ts';

const main = define({
  name: 'shiori',
  description: 'Annotation tracking and governance tool',
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
    'init-registry': initRegistryCommand,
    draft: draftCommand,
    candidates: candidatesCommand,
    show: showCommand,
  },
});
