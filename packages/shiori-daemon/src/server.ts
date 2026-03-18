import * as http from 'node:http';
import type { DaemonConfig, JournalEntry } from './types.ts';
import { verifyWebhookSignature, parseGitHubEvent } from './webhook.ts';
import { type ResolveQueue } from './executor.ts';
import { appendEvent } from './journal.ts';

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
          const parsed = tryParseJson(result.output);
          const entry: JournalEntry = {
            timestamp: new Date().toISOString(),
            event_type: 'issues.closed',
            repository: event.repository.full_name,
            issue_number: event.issue.number,
            resolve_success: true,
            annotations_resolved_count: extractTotalActions(parsed),
          };
          appendEvent(config.journalPath, entry);
          sendJson(res, 200, {
            status: 'resolved',
            output: parsed,
          });
        } else {
          // Log full details for operators; respond with sanitized error only
          console.error(
            `[shiori-daemon] resolve failed (exit ${result.exitCode}): ${result.output}`,
          );
          const entry: JournalEntry = {
            timestamp: new Date().toISOString(),
            event_type: 'issues.closed',
            repository: event.repository.full_name,
            issue_number: event.issue.number,
            resolve_success: false,
            annotations_resolved_count: null,
          };
          appendEvent(config.journalPath, entry);
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

/**
 * Extract totalActions from resolve --closed --format json output.
 *
 * The output follows ResolveJsonOutput schema:
 * `{ meta: {...}, data: { summary: { totalActions: number } } }`
 *
 * Returns null if the structure is not recognized (safe fallback).
 */
function extractTotalActions(parsed: unknown): number | null {
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'data' in parsed &&
    typeof (parsed as Record<string, unknown>).data === 'object'
  ) {
    const data = (parsed as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    if (
      typeof data.summary === 'object' &&
      data.summary !== null &&
      'totalActions' in data.summary
    ) {
      const totalActions = (data.summary as Record<string, unknown>)
        .totalActions;
      return typeof totalActions === 'number' ? totalActions : null;
    }
  }
  return null;
}
