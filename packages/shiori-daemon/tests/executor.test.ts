import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeResolve } from '../src/executor.ts';
import type { DaemonConfig } from '../src/types.ts';

/** Create a config that runs a custom command instead of shiori. */
function makeConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  return {
    port: 3000,
    webhookSecret: 'test',
    cwd: process.cwd(),
    shioriPath: 'echo',
    timeout: 5000,
    ...overrides,
  };
}

describe('executeResolve', () => {
  it('captures stdout from successful execution', async () => {
    // "echo" will print the args as stdout
    const config = makeConfig({ shioriPath: 'echo' });
    const result = await executeResolve(config);

    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes('resolve'));
    assert.ok(result.output.includes('--closed'));
  });

  it('reports failure for non-existent command', async () => {
    const config = makeConfig({ shioriPath: '/nonexistent/shiori-cmd-xxx' });
    const result = await executeResolve(config);

    assert.equal(result.success, false);
    assert.notEqual(result.exitCode, 0);
  });

  it('reports failure for command that exits with error', async () => {
    const config = makeConfig({ shioriPath: 'false' });
    const result = await executeResolve(config);

    assert.equal(result.success, false);
    assert.notEqual(result.exitCode, 0);
  });

  it('respects timeout', async () => {
    // sleep 10 should be killed by 500ms timeout
    const config = makeConfig({ shioriPath: 'sleep', timeout: 500 });
    const result = await executeResolve(config);

    assert.equal(result.success, false);
  });
});
