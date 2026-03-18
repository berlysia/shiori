import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { WebhookEvent } from './types.ts';

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expectedBuf = createHmac('sha256', secret).update(payload).digest();
  const actualHex = signature.slice('sha256='.length);
  const actualBuf = Buffer.from(actualHex, 'hex');

  // Buffer.from with 'hex' encoding silently drops invalid hex characters,
  // producing a shorter buffer. Compare buffer lengths to reject malformed input
  // before timingSafeEqual (which throws RangeError on length mismatch).
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Parse GitHub webhook headers and body into a typed event.
 *
 * Returns null for events we don't care about (non-issues, non-closed).
 * This is not an error — the daemon simply acknowledges and ignores them.
 */
export function parseGitHubEvent(
  headers: IncomingHttpHeaders,
  body: string,
): WebhookEvent | null {
  const eventType = headers['x-github-event'];
  if (eventType !== 'issues') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('action' in parsed) ||
    (parsed as Record<string, unknown>).action !== 'closed'
  ) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  if (
    !issue ||
    typeof issue.number !== 'number' ||
    typeof issue.title !== 'string' ||
    !repo ||
    typeof repo.full_name !== 'string'
  ) {
    return null;
  }

  return {
    type: 'issues',
    action: 'closed',
    issue: { number: issue.number, title: issue.title },
    repository: { full_name: repo.full_name },
  };
}
