import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  writeFileSync,
  chmodSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../src/server.ts';
import { ResolveQueue } from '../src/executor.ts';
import type { DaemonConfig } from '../src/types.ts';

const SECRET = 'test-secret';

function makeJournalPath(): string {
  const dir = join(import.meta.dirname, 'fixtures');
  mkdirSync(dir, { recursive: true });
  return join(dir, `journal-srv-${process.pid}-${Date.now()}.jsonl`);
}

function makeConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  return {
    port: 0, // random port
    webhookSecret: SECRET,
    cwd: process.cwd(),
    shioriPath: 'echo', // will succeed and echo args
    timeout: 5000,
    maxQueueDepth: 10,
    journalPath: makeJournalPath(),
    ...overrides,
  };
}

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

/**
 * Create a temporary executable script that ignores arguments and sleeps.
 * Returns the full path; caller must clean up via unlinkSync.
 */
function createSlowScript(): string {
  const dir = join(import.meta.dirname, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, `slow-srv-${process.pid}.sh`);
  writeFileSync(scriptPath, '#!/bin/sh\nsleep 60\n', { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/** Start server on a random port and return base URL + cleanup. */
async function startServer(
  config: DaemonConfig,
  queue?: ResolveQueue,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const q = queue ?? new ResolveQueue(config.maxQueueDepth);
  const server = createServer(config, q);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('unexpected address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('HTTP server', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  after(async () => {
    for (const s of servers) {
      await s.close();
    }
  });

  it('GET /health returns 200', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.status, 'ok');
  });

  it('POST /webhook rejects missing signature', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  it('POST /webhook rejects invalid signature', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=invalid' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  it('POST /webhook ignores non-issues events', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'push',
      },
      body,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.status, 'ignored');
  });

  it('POST /webhook processes issues closed event', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const body = JSON.stringify({
      action: 'closed',
      issue: { number: 99, title: 'Test issue' },
      repository: { full_name: 'berlysia/shiori' },
    });
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'issues',
      },
      body,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.status, 'resolved');
  });

  it('POST /webhook rejects oversized body with 413', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    // 1 MB + 1 byte exceeds the MAX_BODY_BYTES limit
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(oversizedBody),
      },
      body: oversizedBody,
    });
    assert.equal(res.status, 413);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.error, 'payload too large');
  });

  it('POST /webhook returns sanitized error on resolve failure', async () => {
    // Use a command that always fails — "false" exits with code 1
    const srv = await startServer(makeConfig({ shioriPath: 'false' }));
    servers.push(srv);

    const body = JSON.stringify({
      action: 'closed',
      issue: { number: 1, title: 'Fail test' },
      repository: { full_name: 'test/repo' },
    });
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'issues',
      },
      body,
    });
    assert.equal(res.status, 500);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.error, 'resolve failed');
    // Sanitized: no exitCode or output leaked to the response
    assert.equal(
      'exitCode' in json,
      false,
      'exitCode must not be in error response',
    );
    assert.equal(
      'output' in json,
      false,
      'output must not be in error response',
    );
  });

  it('POST /webhook returns 503 when queue is full', async () => {
    // maxQueueDepth=1, slow script fills the single slot
    const scriptPath = createSlowScript();
    try {
      const config = makeConfig({
        shioriPath: scriptPath,
        timeout: 10000,
        maxQueueDepth: 1,
      });
      const queue = new ResolveQueue(1);
      const srv = await startServer(config, queue);
      servers.push(srv);

      const body = JSON.stringify({
        action: 'closed',
        issue: { number: 1, title: 'Queue test' },
        repository: { full_name: 'test/repo' },
      });
      const headers = {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'issues',
      };

      // First request fills the queue (slow, won't complete quickly)
      const req1 = fetch(`${srv.baseUrl}/webhook`, {
        method: 'POST',
        headers,
        body,
      });

      // Give a moment for the first request to be enqueued
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second request should be rejected with 503
      const res2 = await fetch(`${srv.baseUrl}/webhook`, {
        method: 'POST',
        headers,
        body,
      });

      assert.equal(res2.status, 503);
      const json = (await res2.json()) as Record<string, unknown>;
      assert.equal(json.error, 'queue full');

      // Don't await req1 — let the slow script timeout naturally
      void req1;
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('returns 404 for unknown routes', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const res = await fetch(`${srv.baseUrl}/unknown`);
    assert.equal(res.status, 404);
  });

  it('writes journal entry on successful resolve', async () => {
    const journalPath = makeJournalPath();
    const config = makeConfig({ journalPath });
    const srv = await startServer(config);
    servers.push(srv);

    const body = JSON.stringify({
      action: 'closed',
      issue: { number: 77, title: 'Journal test' },
      repository: { full_name: 'test/journal-repo' },
    });
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'issues',
      },
      body,
    });
    assert.equal(res.status, 200);

    // Verify journal file was created with correct entry
    assert.equal(existsSync(journalPath), true);
    const lines = readFileSync(journalPath, 'utf-8')
      .split('\n')
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(entry.event_type, 'issues.closed');
    assert.equal(entry.repository, 'test/journal-repo');
    assert.equal(entry.issue_number, 77);
    assert.equal(entry.resolve_success, true);
    // echo output is not ResolveJsonOutput, so totalActions cannot be extracted
    assert.equal(entry.annotations_resolved_count, null);

    // Clean up
    unlinkSync(journalPath);
  });

  it('extracts annotations_resolved_count from ResolveJsonOutput', async () => {
    const journalPath = makeJournalPath();
    // Create a script that outputs ResolveJsonOutput-shaped JSON
    const dir = join(import.meta.dirname, 'fixtures');
    mkdirSync(dir, { recursive: true });
    const scriptPath = join(dir, `json-srv-${process.pid}.sh`);
    const jsonOutput = JSON.stringify({
      meta: { command: 'resolve', mode: 'closed' },
      data: { summary: { totalActions: 5, totalRefs: 2 } },
    });
    writeFileSync(scriptPath, `#!/bin/sh\necho '${jsonOutput}'\n`, {
      mode: 0o755,
    });
    chmodSync(scriptPath, 0o755);

    try {
      const config = makeConfig({ shioriPath: scriptPath, journalPath });
      const srv = await startServer(config);
      servers.push(srv);

      const body = JSON.stringify({
        action: 'closed',
        issue: { number: 55, title: 'Count test' },
        repository: { full_name: 'test/count-repo' },
      });
      const res = await fetch(`${srv.baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'x-hub-signature-256': sign(body),
          'x-github-event': 'issues',
        },
        body,
      });
      assert.equal(res.status, 200);

      const lines = readFileSync(journalPath, 'utf-8')
        .split('\n')
        .filter(Boolean);
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
      assert.equal(entry.annotations_resolved_count, 5);
      assert.equal(entry.resolve_success, true);
    } finally {
      unlinkSync(scriptPath);
      if (existsSync(journalPath)) unlinkSync(journalPath);
    }
  });

  it('writes journal entry on failed resolve', async () => {
    const journalPath = makeJournalPath();
    const config = makeConfig({ shioriPath: 'false', journalPath });
    const srv = await startServer(config);
    servers.push(srv);

    const body = JSON.stringify({
      action: 'closed',
      issue: { number: 88, title: 'Journal fail test' },
      repository: { full_name: 'test/fail-repo' },
    });
    const res = await fetch(`${srv.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body),
        'x-github-event': 'issues',
      },
      body,
    });
    assert.equal(res.status, 500);

    // Verify journal file was created with failure entry
    assert.equal(existsSync(journalPath), true);
    const lines = readFileSync(journalPath, 'utf-8')
      .split('\n')
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(entry.event_type, 'issues.closed');
    assert.equal(entry.repository, 'test/fail-repo');
    assert.equal(entry.issue_number, 88);
    assert.equal(entry.resolve_success, false);
    assert.equal(entry.annotations_resolved_count, null);

    // Clean up
    unlinkSync(journalPath);
  });
});
