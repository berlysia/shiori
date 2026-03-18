import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, parseGitHubEvent } from '../src/webhook.ts';

/** Helper to create a valid HMAC-SHA256 signature. */
function sign(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret-123';
  const payload = '{"action":"closed"}';

  it('accepts a valid signature', () => {
    const sig = sign(payload, secret);
    assert.equal(verifyWebhookSignature(payload, sig, secret), true);
  });

  it('rejects an invalid signature', () => {
    assert.equal(
      verifyWebhookSignature(payload, 'sha256=deadbeef0'.repeat(7), secret),
      false,
    );
  });

  it('rejects a signature without sha256= prefix', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    assert.equal(verifyWebhookSignature(payload, hmac, secret), false);
  });

  it('rejects when secret differs', () => {
    const sig = sign(payload, 'wrong-secret');
    assert.equal(verifyWebhookSignature(payload, sig, secret), false);
  });

  it('rejects when payload is tampered', () => {
    const sig = sign(payload, secret);
    assert.equal(
      verifyWebhookSignature('{"action":"opened"}', sig, secret),
      false,
    );
  });
});

describe('parseGitHubEvent', () => {
  const closedPayload = JSON.stringify({
    action: 'closed',
    issue: { number: 42, title: 'Fix bug' },
    repository: { full_name: 'berlysia/shiori' },
  });

  it('parses issues closed event', () => {
    const event = parseGitHubEvent(
      { 'x-github-event': 'issues' },
      closedPayload,
    );
    assert.deepEqual(event, {
      type: 'issues',
      action: 'closed',
      issue: { number: 42, title: 'Fix bug' },
      repository: { full_name: 'berlysia/shiori' },
    });
  });

  it('returns null for non-issues events', () => {
    const event = parseGitHubEvent({ 'x-github-event': 'push' }, closedPayload);
    assert.equal(event, null);
  });

  it('returns null for issues opened event', () => {
    const body = JSON.stringify({
      action: 'opened',
      issue: { number: 1, title: 'New' },
      repository: { full_name: 'berlysia/shiori' },
    });
    const event = parseGitHubEvent({ 'x-github-event': 'issues' }, body);
    assert.equal(event, null);
  });

  it('returns null for missing x-github-event header', () => {
    const event = parseGitHubEvent({}, closedPayload);
    assert.equal(event, null);
  });

  it('returns null for invalid JSON body', () => {
    const event = parseGitHubEvent({ 'x-github-event': 'issues' }, 'not json');
    assert.equal(event, null);
  });

  it('returns null when issue fields are missing', () => {
    const body = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'a/b' },
    });
    const event = parseGitHubEvent({ 'x-github-event': 'issues' }, body);
    assert.equal(event, null);
  });

  it('returns null when repository is missing', () => {
    const body = JSON.stringify({
      action: 'closed',
      issue: { number: 1, title: 'T' },
    });
    const event = parseGitHubEvent({ 'x-github-event': 'issues' }, body);
    assert.equal(event, null);
  });
});
