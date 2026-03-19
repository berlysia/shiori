import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendEvent } from '../src/journal.ts';
import type { JournalEntry } from '../src/types.ts';

function makeTmpPath(): string {
  return join(tmpdir(), `journal-${process.pid}-${Date.now()}.jsonl`);
}

function makeEntry(overrides?: Partial<JournalEntry>): JournalEntry {
  return {
    timestamp: '2025-07-18T12:00:00.000Z',
    event_type: 'issues.closed',
    repository: 'berlysia/shiori',
    issue_number: 42,
    resolve_success: true,
    annotations_resolved_count: 3,
    ...overrides,
  };
}

describe('appendEvent', () => {
  const files: string[] = [];

  afterEach(() => {
    for (const f of files) {
      if (existsSync(f)) unlinkSync(f);
    }
    files.length = 0;
  });

  it('writes a single JSONL line', () => {
    const path = makeTmpPath();
    files.push(path);
    const entry = makeEntry();

    appendEvent(path, entry);

    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), entry);
  });

  it('appends multiple lines on repeated calls', () => {
    const path = makeTmpPath();
    files.push(path);
    const entry1 = makeEntry({ issue_number: 1 });
    const entry2 = makeEntry({ issue_number: 2 });

    appendEvent(path, entry1);
    appendEvent(path, entry2);

    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), entry1);
    assert.deepEqual(JSON.parse(lines[1]!), entry2);
  });

  it('serializes all fields correctly', () => {
    const path = makeTmpPath();
    files.push(path);
    const entry = makeEntry();

    appendEvent(path, entry);

    const parsed = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]!);
    assert.equal(parsed.timestamp, '2025-07-18T12:00:00.000Z');
    assert.equal(parsed.event_type, 'issues.closed');
    assert.equal(parsed.repository, 'berlysia/shiori');
    assert.equal(parsed.issue_number, 42);
    assert.equal(parsed.resolve_success, true);
    assert.equal(parsed.annotations_resolved_count, 3);
  });

  it('creates file if it does not exist', () => {
    const path = makeTmpPath();
    files.push(path);
    assert.equal(existsSync(path), false);

    appendEvent(path, makeEntry());

    assert.equal(existsSync(path), true);
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  it('serializes null annotations_resolved_count correctly', () => {
    const path = makeTmpPath();
    files.push(path);
    const entry = makeEntry({
      resolve_success: false,
      annotations_resolved_count: null,
    });

    appendEvent(path, entry);

    const parsed = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]!);
    assert.equal(parsed.annotations_resolved_count, null);
  });
});
