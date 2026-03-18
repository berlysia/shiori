import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJournalEntry,
  resolveJournalPath,
  recordJournalEvent,
  DEFAULT_JOURNAL_PATH,
  JOURNAL_PATH_ENV,
  JOURNAL_DISABLE_ENV,
} from '../src/core/journal.ts';
import type { CliJournalEntry } from '../src/core/types.ts';

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname,
    `fixtures/journal-test-${process.pid}-${Date.now()}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(overrides?: Partial<CliJournalEntry>): CliJournalEntry {
  return {
    timestamp: '2026-03-18T12:00:00.000Z',
    source: 'cli',
    event_type: 'cli.resolve',
    refs: ['SUP-1234'],
    success: true,
    entries_added: null,
    entries_removed: 1,
    ...overrides,
  };
}

describe('resolveJournalPath', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      [JOURNAL_PATH_ENV]: process.env[JOURNAL_PATH_ENV],
      [JOURNAL_DISABLE_ENV]: process.env[JOURNAL_DISABLE_ENV],
    };
    delete process.env[JOURNAL_PATH_ENV];
    delete process.env[JOURNAL_DISABLE_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns default path relative to cwd', () => {
    const result = resolveJournalPath('/my/project');
    assert.equal(result, `/my/project/${DEFAULT_JOURNAL_PATH}`);
  });

  it('returns env override when SHIORI_JOURNAL_PATH is set', () => {
    process.env[JOURNAL_PATH_ENV] = '/custom/journal.jsonl';
    const result = resolveJournalPath('/my/project');
    assert.equal(result, '/custom/journal.jsonl');
  });

  it('returns null when SHIORI_JOURNAL_DISABLE is set', () => {
    process.env[JOURNAL_DISABLE_ENV] = '1';
    const result = resolveJournalPath('/my/project');
    assert.equal(result, null);
  });

  it('SHIORI_JOURNAL_DISABLE takes precedence over SHIORI_JOURNAL_PATH', () => {
    process.env[JOURNAL_DISABLE_ENV] = 'true';
    process.env[JOURNAL_PATH_ENV] = '/custom/journal.jsonl';
    const result = resolveJournalPath('/my/project');
    assert.equal(result, null);
  });
});

describe('appendJournalEntry', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      if (existsSync(d)) rmSync(d, { recursive: true });
    }
    dirs.length = 0;
  });

  it('writes a single JSONL line', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const path = join(dir, 'journal.jsonl');
    const entry = makeEntry();

    appendJournalEntry(path, entry);

    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), entry);
  });

  it('appends multiple lines on repeated calls', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const path = join(dir, 'journal.jsonl');
    const entry1 = makeEntry({ refs: ['SUP-001'] });
    const entry2 = makeEntry({ refs: ['SUP-002'] });

    appendJournalEntry(path, entry1);
    appendJournalEntry(path, entry2);

    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), entry1);
    assert.deepEqual(JSON.parse(lines[1]!), entry2);
  });

  it('serializes all CliJournalEntry fields correctly', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const path = join(dir, 'journal.jsonl');
    const entry = makeEntry();

    appendJournalEntry(path, entry);

    const parsed = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]!);
    assert.equal(parsed.timestamp, '2026-03-18T12:00:00.000Z');
    assert.equal(parsed.source, 'cli');
    assert.equal(parsed.event_type, 'cli.resolve');
    assert.deepEqual(parsed.refs, ['SUP-1234']);
    assert.equal(parsed.success, true);
    assert.equal(parsed.entries_added, null);
    assert.equal(parsed.entries_removed, 1);
  });

  it('creates parent directories if they do not exist', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const nestedPath = join(dir, 'deep', 'nested', 'journal.jsonl');

    appendJournalEntry(nestedPath, makeEntry());

    assert.equal(existsSync(nestedPath), true);
    const lines = readFileSync(nestedPath, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  it('serializes null entries_added/entries_removed correctly', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const path = join(dir, 'journal.jsonl');
    const entry = makeEntry({
      success: false,
      entries_added: null,
      entries_removed: null,
    });

    appendJournalEntry(path, entry);

    const parsed = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]!);
    assert.equal(parsed.entries_added, null);
    assert.equal(parsed.entries_removed, null);
  });

  it('handles all event types', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const path = join(dir, 'journal.jsonl');

    const eventTypes = [
      'cli.resolve',
      'cli.resolve.bulk',
      'cli.adopt',
      'cli.update',
      'cli.annotate',
      'cli.migrate',
    ] as const;

    for (const eventType of eventTypes) {
      appendJournalEntry(path, makeEntry({ event_type: eventType }));
    }

    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, eventTypes.length);
    for (let i = 0; i < eventTypes.length; i++) {
      const parsed = JSON.parse(lines[i]!);
      assert.equal(parsed.event_type, eventTypes[i]);
      assert.equal(parsed.source, 'cli');
    }
  });

  it('does not throw on write failure (invalid path)', () => {
    // Writing to a path that cannot exist (file as directory)
    const dir = makeTmpDir();
    dirs.push(dir);
    const blockingFile = join(dir, 'blocker');
    // Create a file, then try to use it as a directory
    appendJournalEntry(blockingFile, makeEntry());
    // Now try to write inside the file-as-directory — this should not throw
    assert.doesNotThrow(() => {
      appendJournalEntry(
        join(blockingFile, 'impossible', 'journal.jsonl'),
        makeEntry(),
      );
    });
  });
});

describe('recordJournalEvent', () => {
  const dirs: string[] = [];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      [JOURNAL_PATH_ENV]: process.env[JOURNAL_PATH_ENV],
      [JOURNAL_DISABLE_ENV]: process.env[JOURNAL_DISABLE_ENV],
    };
    delete process.env[JOURNAL_PATH_ENV];
    delete process.env[JOURNAL_DISABLE_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const d of dirs) {
      if (existsSync(d)) rmSync(d, { recursive: true });
    }
    dirs.length = 0;
  });

  it('writes a journal entry with correct structure', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const journalPath = join(dir, '.config', 'shiori', 'journal.jsonl');
    process.env[JOURNAL_PATH_ENV] = journalPath;

    recordJournalEvent({
      cwd: dir,
      eventType: 'cli.resolve',
      refs: ['SUP-1234'],
      success: true,
      entriesRemoved: 1,
    });

    assert.equal(existsSync(journalPath), true);
    const lines = readFileSync(journalPath, 'utf-8')
      .split('\n')
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.source, 'cli');
    assert.equal(parsed.event_type, 'cli.resolve');
    assert.deepEqual(parsed.refs, ['SUP-1234']);
    assert.equal(parsed.success, true);
    assert.equal(parsed.entries_added, null);
    assert.equal(parsed.entries_removed, 1);
    // Timestamp should be a valid ISO string
    assert.ok(parsed.timestamp);
    assert.ok(!isNaN(new Date(parsed.timestamp).getTime()));
  });

  it('is a no-op when SHIORI_JOURNAL_DISABLE is set', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    process.env[JOURNAL_DISABLE_ENV] = '1';

    recordJournalEvent({
      cwd: dir,
      eventType: 'cli.adopt',
      refs: ['ADOPT-001'],
      success: true,
      entriesAdded: 5,
    });

    // No journal file should be created
    const journalPath = join(dir, DEFAULT_JOURNAL_PATH);
    assert.equal(existsSync(journalPath), false);
  });

  it('uses default path when no env override', () => {
    const dir = makeTmpDir();
    dirs.push(dir);

    recordJournalEvent({
      cwd: dir,
      eventType: 'cli.update',
      refs: ['REF-001'],
      success: true,
      entriesAdded: 2,
    });

    const journalPath = join(dir, DEFAULT_JOURNAL_PATH);
    assert.equal(existsSync(journalPath), true);
    const lines = readFileSync(journalPath, 'utf-8')
      .split('\n')
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.event_type, 'cli.update');
  });

  it('defaults entries_added and entries_removed to null', () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const journalPath = join(dir, '.config', 'shiori', 'journal.jsonl');
    process.env[JOURNAL_PATH_ENV] = journalPath;

    recordJournalEvent({
      cwd: dir,
      eventType: 'cli.resolve',
      refs: ['SUP-1234'],
      success: true,
    });

    const parsed = JSON.parse(
      readFileSync(journalPath, 'utf-8').split('\n').filter(Boolean)[0]!,
    );
    assert.equal(parsed.entries_added, null);
    assert.equal(parsed.entries_removed, null);
  });
});
