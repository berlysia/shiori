import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from '../src/server.ts';
import type { DaemonConfig } from '../src/types.ts';

const SECRET = 'test-secret';

function makeConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  return {
    port: 0, // random port
    webhookSecret: SECRET,
    cwd: process.cwd(),
    shioriPath: 'echo', // will succeed and echo args
    timeout: 5000,
    ...overrides,
  };
}

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

/** Start server on a random port and return base URL + cleanup. */
async function startServer(
  config: DaemonConfig,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(config);
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

  it('returns 404 for unknown routes', async () => {
    const srv = await startServer(makeConfig());
    servers.push(srv);

    const res = await fetch(`${srv.baseUrl}/unknown`);
    assert.equal(res.status, 404);
  });
});
