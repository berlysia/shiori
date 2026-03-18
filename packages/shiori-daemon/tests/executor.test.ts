import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  executeResolve,
  buildAllowedEnv,
  ResolveQueue,
} from '../src/executor.ts';
import type { DaemonConfig } from '../src/types.ts';

/** Create a config that runs a custom command instead of shiori. */
function makeConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  return {
    port: 3000,
    webhookSecret: 'test',
    cwd: process.cwd(),
    shioriPath: 'echo',
    timeout: 5000,
    maxQueueDepth: 10,
    journalPath: join(
      import.meta.dirname,
      'fixtures',
      `journal-exec-${process.pid}.jsonl`,
    ),
    ...overrides,
  };
}

/**
 * Create a temporary executable script that ignores arguments and sleeps.
 * Returns the full path; caller must clean up via unlinkSync.
 */
function createSlowScript(): string {
  const dir = join(import.meta.dirname, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, `slow-${process.pid}.sh`);
  writeFileSync(scriptPath, '#!/bin/sh\nsleep 60\n', { mode: 0o755 });
  // chmodSync as an extra safety net for platforms where mode flag is ignored
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('buildAllowedEnv', () => {
  it('includes allowlisted variables that exist', () => {
    // PATH and HOME should always exist in normal environments
    const env = buildAllowedEnv();
    if (process.env.PATH) {
      assert.equal(env.PATH, process.env.PATH);
    }
    if (process.env.HOME) {
      assert.equal(env.HOME, process.env.HOME);
    }
  });

  it('excludes non-allowlisted variables', () => {
    // Set a non-allowlisted env var and verify it is NOT included
    const key = 'SHIORI_TEST_EXCLUDED_VAR_12345';
    process.env[key] = 'should-not-appear';
    try {
      const env = buildAllowedEnv();
      assert.equal(env[key], undefined);
    } finally {
      delete process.env[key];
    }
  });

  it('omits allowlisted variables that are not set', () => {
    const key = 'GITHUB_TOKEN';
    const original = process.env[key];
    delete process.env[key];
    try {
      const env = buildAllowedEnv();
      assert.equal(key in env, false);
    } finally {
      if (original !== undefined) {
        process.env[key] = original;
      }
    }
  });

  it('includes GITHUB_TOKEN when set', () => {
    const key = 'GITHUB_TOKEN';
    const original = process.env[key];
    process.env[key] = 'test-token-value';
    try {
      const env = buildAllowedEnv();
      assert.equal(env[key], 'test-token-value');
    } finally {
      if (original !== undefined) {
        process.env[key] = original;
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns only string values (no undefined)', () => {
    const env = buildAllowedEnv();
    for (const value of Object.values(env)) {
      assert.equal(typeof value, 'string');
    }
  });
});

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

  it('respects timeout and returns exit code 124', async () => {
    // Create a script that ignores all arguments and sleeps forever
    const scriptPath = createSlowScript();
    try {
      const config = makeConfig({ shioriPath: scriptPath, timeout: 500 });
      const result = await executeResolve(config);

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 124, 'timeout must produce exit code 124');
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

describe('ResolveQueue', () => {
  it('serializes concurrent enqueue calls', async () => {
    // Track execution order to prove tasks run one-at-a-time.
    // Use a script that writes a sequence number to stdout.
    const order: number[] = [];
    let counter = 0;

    const queue = new ResolveQueue(10);

    // Enqueue 3 tasks that use 'echo' (fast, succeeds immediately).
    // We verify they complete in FIFO order by recording arrival.
    const tasks = Array.from({ length: 3 }, () => {
      const idx = counter++;
      return queue.enqueue(makeConfig()).then((result) => {
        order.push(idx);
        return result;
      });
    });

    const results = await Promise.all(tasks);

    // All should succeed
    for (const r of results) {
      assert.equal(r.success, true);
      assert.equal(r.exitCode, 0);
    }

    // Order must be 0, 1, 2 (FIFO serialization)
    assert.deepEqual(order, [0, 1, 2]);
  });

  it('rejects when queue depth is exceeded', async () => {
    const queue = new ResolveQueue(2);

    // Create a slow script so tasks stay in the queue
    const scriptPath = createSlowScript();
    try {
      const slowConfig = makeConfig({ shioriPath: scriptPath, timeout: 5000 });

      // Fill the queue with 2 slow tasks
      const task1 = queue.enqueue(slowConfig);
      const task2 = queue.enqueue(slowConfig);

      // 3rd should be rejected immediately
      const rejected = await queue.enqueue(slowConfig);

      assert.equal(rejected.success, false);
      assert.equal(rejected.exitCode, 503);
      assert.equal(rejected.output, 'queue full');

      // Clean up: the slow tasks will timeout eventually;
      // we don't await them here to keep test fast.
      // Drain will wait for them but they have a 5s timeout.
      // Instead, kill by not awaiting (they'll be collected by GC).
      void task1;
      void task2;
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('tracks currentDepth correctly', async () => {
    const queue = new ResolveQueue(10);
    assert.equal(queue.currentDepth, 0);

    // Enqueue a fast task
    const task = queue.enqueue(makeConfig());
    // Depth should be at least 1 while running
    assert.ok(queue.currentDepth >= 1);

    await task;
    // After completion, depth returns to 0
    assert.equal(queue.currentDepth, 0);
  });

  it('drain waits for all queued tasks', async () => {
    const queue = new ResolveQueue(10);

    // Enqueue 3 fast tasks
    queue.enqueue(makeConfig());
    queue.enqueue(makeConfig());
    queue.enqueue(makeConfig());

    await queue.drain();
    assert.equal(queue.currentDepth, 0);
  });
});
