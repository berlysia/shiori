import * as http from 'node:http';
import type { DaemonConfig } from './types.ts';
import { verifyWebhookSignature, parseGitHubEvent } from './webhook.ts';
import { type ResolveQueue } from './executor.ts';

/** Maximum request body size (1 MB). Prevents DoS via oversized payloads. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Collect the full request body as a string, rejecting payloads over MAX_BODY_BYTES.
 *
 * Instead of destroying the socket immediately (which prevents sending a response),
 * we set a flag and drain remaining data so the HTTP response can still be written.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let exceeded = false;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        exceeded = true;
        // Stop accumulating but keep draining so 'end' fires normally
        return;
      }
      if (!exceeded) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (exceeded) {
        reject(new BodyTooLargeError());
      } else {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    req.on('error', reject);
  });
}

/** Sentinel error for oversized request bodies. */
class BodyTooLargeError extends Error {
  constructor() {
    super('request body too large');
    this.name = 'BodyTooLargeError';
  }
}

/** Send a JSON response. */
function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

/**
 * Create the daemon HTTP server.
 *
 * Endpoints:
 * - GET  /health  → 200 OK
 * - POST /webhook → Verify signature, parse event, execute resolve (queued)
 */
export function createServer(
  config: DaemonConfig,
  queue: ResolveQueue,
): http.Server {
  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    // Webhook endpoint
    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        const body = await readBody(req);

        // Verify HMAC signature
        const signature = req.headers['x-hub-signature-256'];
        if (typeof signature !== 'string') {
          sendJson(res, 401, { error: 'missing signature' });
          return;
        }

        if (!verifyWebhookSignature(body, signature, config.webhookSecret)) {
          sendJson(res, 401, { error: 'invalid signature' });
          return;
        }

        // Parse event
        const event = parseGitHubEvent(req.headers, body);
        if (event === null) {
          // Not an event we care about — acknowledge silently
          sendJson(res, 200, { status: 'ignored' });
          return;
        }

        // Execute resolve
        console.log(
          `[shiori-daemon] issue closed: ${event.repository.full_name}#${event.issue.number} "${event.issue.title}"`,
        );

        const result = await queue.enqueue(config);

        if (result.exitCode === 503) {
          sendJson(res, 503, { error: 'queue full' });
        } else if (result.success) {
          console.log('[shiori-daemon] resolve completed successfully');
          sendJson(res, 200, {
            status: 'resolved',
            output: tryParseJson(result.output),
          });
        } else {
          // Log full details for operators; respond with sanitized error only
          console.error(
            `[shiori-daemon] resolve failed (exit ${result.exitCode}): ${result.output}`,
          );
          sendJson(res, 500, { error: 'resolve failed' });
        }
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          sendJson(res, 413, { error: 'payload too large' });
          return;
        }
        console.error('[shiori-daemon] unexpected error:', err);
        sendJson(res, 500, { error: 'internal error' });
      }
      return;
    }

    // Unknown route
    sendJson(res, 404, { error: 'not found' });
  });

  return server;
}

/** Try to parse JSON output; return raw string on failure. */
function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
