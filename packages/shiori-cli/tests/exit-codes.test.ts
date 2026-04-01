import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExitCode,
  EXIT_CODE_POLICIES,
  REGISTERED_COMMANDS,
  getExitCodePolicy,
  findMissingPolicies,
  findStalePolicies,
  findMissingCliSubCommands,
  findStaleCliSubCommands,
} from '../src/core/exit-codes.ts';
import { checkExitCodePolicies } from '../src/commands/doctor/checks.ts';
import { CLI_SUBCOMMAND_KEYS } from '../src/commands/command-map.ts';

describe('ExitCode constants', () => {
  it('defines SUCCESS as 0', () => {
    assert.equal(ExitCode.SUCCESS, 0);
  });

  it('defines GOVERNANCE_VIOLATION as 1', () => {
    assert.equal(ExitCode.GOVERNANCE_VIOLATION, 1);
  });

  it('defines USAGE_ERROR as 2', () => {
    assert.equal(ExitCode.USAGE_ERROR, 2);
  });

  it('defines ENVIRONMENT_ERROR as 3', () => {
    assert.equal(ExitCode.ENVIRONMENT_ERROR, 3);
  });
});

describe('EXIT_CODE_POLICIES', () => {
  it('has a policy for every registered command', () => {
    const missing = findMissingPolicies(REGISTERED_COMMANDS);
    assert.deepEqual(
      missing,
      [],
      `Missing policies for: ${missing.join(', ')}`,
    );
  });

  it('has no stale policies for removed commands', () => {
    const stale = findStalePolicies(REGISTERED_COMMANDS);
    assert.deepEqual(stale, [], `Stale policies for: ${stale.join(', ')}`);
  });

  it('governance commands have non-null failCondition', () => {
    for (const [cmd, policy] of Object.entries(EXIT_CODE_POLICIES)) {
      if (policy.category === 'governance') {
        assert.notEqual(
          policy.failCondition,
          null,
          `Governance command "${cmd}" should have a failCondition`,
        );
      }
    }
  });

  it('passthrough commands have null failCondition', () => {
    for (const [cmd, policy] of Object.entries(EXIT_CODE_POLICIES)) {
      if (policy.category === 'passthrough') {
        assert.equal(
          policy.failCondition,
          null,
          `Passthrough command "${cmd}" should have null failCondition`,
        );
      }
    }
  });

  it('usage commands have non-null failCondition', () => {
    for (const [cmd, policy] of Object.entries(EXIT_CODE_POLICIES)) {
      if (policy.category === 'usage') {
        assert.notEqual(
          policy.failCondition,
          null,
          `Usage command "${cmd}" should have a failCondition`,
        );
      }
    }
  });
});

describe('getExitCodePolicy', () => {
  it('returns policy for known command', () => {
    const policy = getExitCodePolicy('verify');
    assert.ok(policy);
    assert.equal(policy.category, 'governance');
    assert.equal(policy.failCondition, 'summary.errors > 0');
  });

  it('returns undefined for unknown command', () => {
    const policy = getExitCodePolicy('nonexistent');
    assert.equal(policy, undefined);
  });
});

describe('findMissingPolicies', () => {
  it('returns empty for fully covered commands', () => {
    const result = findMissingPolicies(['verify', 'check']);
    assert.deepEqual(result, []);
  });

  it('returns commands without policies', () => {
    const result = findMissingPolicies(['verify', 'unknown-cmd']);
    assert.deepEqual(result, ['unknown-cmd']);
  });
});

describe('findStalePolicies', () => {
  it('returns empty when all policies have matching commands', () => {
    const allPolicyCommands = Object.keys(EXIT_CODE_POLICIES);
    const result = findStalePolicies(allPolicyCommands);
    assert.deepEqual(result, []);
  });

  it('returns policies for commands not in the list', () => {
    const result = findStalePolicies(['verify']);
    // Should include all other policies that are not "verify"
    assert.ok(result.length > 0);
    assert.ok(!result.includes('verify'));
  });
});

describe('checkExitCodePolicies (doctor check)', () => {
  it('passes when all commands have policies', () => {
    const check = checkExitCodePolicies(REGISTERED_COMMANDS);
    assert.equal(check.status, 'pass');
    assert.equal(check.name, 'exit-code-policies');
    assert.match(
      check.message,
      /All \d+ commands have exit code policies defined/,
    );
  });

  it('warns when commands are missing policies', () => {
    const commands = [...REGISTERED_COMMANDS, 'new-command'];
    const check = checkExitCodePolicies(commands);
    assert.equal(check.status, 'warn');
    assert.match(check.message, /missing policy/);
    assert.match(check.message, /new-command/);
  });

  it('warns when stale policies exist', () => {
    // Pass a subset of commands — policies for missing commands become stale
    const check = checkExitCodePolicies(['verify']);
    assert.equal(check.status, 'warn');
    assert.match(check.message, /stale/);
  });
});

describe('REGISTERED_COMMANDS sync with cli.ts', () => {
  it('contains expected core commands', () => {
    const expected = [
      'init',
      'scan',
      'verify',
      'check',
      'update',
      'health',
      'doctor',
      'report',
      'triage',
    ];
    for (const cmd of expected) {
      assert.ok(
        REGISTERED_COMMANDS.includes(cmd),
        `REGISTERED_COMMANDS should include "${cmd}"`,
      );
    }
  });

  it('has no duplicates', () => {
    const unique = new Set(REGISTERED_COMMANDS);
    assert.equal(
      unique.size,
      REGISTERED_COMMANDS.length,
      'REGISTERED_COMMANDS should have no duplicates',
    );
  });
});

describe('findMissingCliSubCommands', () => {
  it('returns empty when all registered commands are in cli.ts', () => {
    const result = findMissingCliSubCommands(
      ['init', 'scan', 'verify'],
      ['init', 'scan', 'verify'],
    );
    assert.deepEqual(result, []);
  });

  it('returns commands missing from cli.ts subCommands', () => {
    const result = findMissingCliSubCommands(
      ['init', 'scan', 'ghost'],
      ['init', 'scan'],
    );
    assert.deepEqual(result, ['ghost']);
  });
});

describe('findStaleCliSubCommands', () => {
  it('returns empty when all cli.ts keys are in REGISTERED_COMMANDS', () => {
    const result = findStaleCliSubCommands(
      ['init', 'scan', 'verify'],
      ['init', 'scan', 'verify'],
    );
    assert.deepEqual(result, []);
  });

  it('returns cli.ts keys not in REGISTERED_COMMANDS', () => {
    const result = findStaleCliSubCommands(
      ['init', 'scan'],
      ['init', 'scan', 'extra'],
    );
    assert.deepEqual(result, ['extra']);
  });
});

describe('Three-way consistency (integration)', () => {
  it('REGISTERED_COMMANDS matches CLI_SUBCOMMAND_KEYS', () => {
    const missing = findMissingCliSubCommands(
      REGISTERED_COMMANDS,
      CLI_SUBCOMMAND_KEYS,
    );
    assert.deepEqual(
      missing,
      [],
      `Commands in REGISTERED_COMMANDS but missing from cli.ts: ${missing.join(', ')}`,
    );

    const stale = findStaleCliSubCommands(
      REGISTERED_COMMANDS,
      CLI_SUBCOMMAND_KEYS,
    );
    assert.deepEqual(
      stale,
      [],
      `Commands in cli.ts but missing from REGISTERED_COMMANDS: ${stale.join(', ')}`,
    );
  });

  it('all three sources have the same count', () => {
    const policyKeys = Object.keys(EXIT_CODE_POLICIES);
    assert.equal(
      REGISTERED_COMMANDS.length,
      CLI_SUBCOMMAND_KEYS.length,
      `REGISTERED_COMMANDS (${REGISTERED_COMMANDS.length}) vs CLI_SUBCOMMAND_KEYS (${CLI_SUBCOMMAND_KEYS.length})`,
    );
    assert.equal(
      REGISTERED_COMMANDS.length,
      policyKeys.length,
      `REGISTERED_COMMANDS (${REGISTERED_COMMANDS.length}) vs EXIT_CODE_POLICIES (${policyKeys.length})`,
    );
  });
});
