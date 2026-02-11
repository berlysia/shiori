#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { scanCommand } from './commands/scan-cli.ts';
import { verifyCommand } from './commands/verify-cli.ts';
import { initLedgerCommand } from './commands/init-ledger-cli.ts';

const main = define({
  name: 'lint-ledger',
  description: 'Lint suppression ledger management tool',
  run: () => {
    console.log('Run "lint-ledger --help" for usage information.');
  },
});

await cli(process.argv.slice(2), main, {
  name: 'lint-ledger',
  version: '0.0.1',
  description: 'Manage lint suppression exceptions with a ledger',
  subCommands: {
    scan: scanCommand,
    verify: verifyCommand,
    'init-ledger': initLedgerCommand,
  },
});
