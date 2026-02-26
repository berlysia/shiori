import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileExists, fileContainsLine } from '../src/commands/init.ts';

describe('fileExists', () => {
  let tmpDir: string;

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true for existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'exists.txt');
    await writeFile(filePath, 'content', 'utf-8');

    assert.equal(await fileExists(filePath), true);
  });

  it('returns false for non-existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'nope.txt');

    assert.equal(await fileExists(filePath), false);
  });

  it('returns true for existing directory', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const dirPath = join(tmpDir, 'subdir');
    await mkdir(dirPath);

    assert.equal(await fileExists(dirPath), true);
  });
});

describe('fileContainsLine', () => {
  let tmpDir: string;

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when file contains the exact line', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(
      filePath,
      'node_modules/\n.config/shiori/scan-result.json\ndist/\n',
      'utf-8',
    );

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      true,
    );
  });

  it('returns true when line has surrounding whitespace', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(
      filePath,
      'node_modules/\n  .config/shiori/scan-result.json  \ndist/\n',
      'utf-8',
    );

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      true,
    );
  });

  it('returns false when file does not contain the line', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(filePath, 'node_modules/\ndist/\n', 'utf-8');

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      false,
    );
  });

  it('returns false when file does not exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'nonexistent');

    assert.equal(await fileContainsLine(filePath, 'some-line'), false);
  });

  it('handles empty file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'empty');
    await writeFile(filePath, '', 'utf-8');

    assert.equal(await fileContainsLine(filePath, 'anything'), false);
  });
});
