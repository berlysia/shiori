import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeOutput } from '../src/core/cli-output.ts';

describe('writeOutput', () => {
  let tempDir: string;
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let stdoutOutput: string[];
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-cli-output-'));
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    stderrOutput = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    stdoutOutput = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutOutput.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes to stdout when no outputPath', async () => {
    const result = await writeOutput('hello world', { cwd: tempDir });
    assert.equal(result, true);
    assert.ok(stdoutOutput.some((s) => s.includes('hello world')));
  });

  it('writes to file when outputPath is provided', async () => {
    const result = await writeOutput('file content', {
      outputPath: 'out.txt',
      cwd: tempDir,
    });
    assert.equal(result, true);

    const content = await readFile(join(tempDir, 'out.txt'), 'utf-8');
    assert.equal(content, 'file content\n');
  });

  it('creates parent directories', async () => {
    const result = await writeOutput('nested', {
      outputPath: 'sub/dir/out.txt',
      cwd: tempDir,
    });
    assert.equal(result, true);

    const content = await readFile(join(tempDir, 'sub/dir/out.txt'), 'utf-8');
    assert.equal(content, 'nested\n');
  });

  it('logs label to stderr when writing to file', async () => {
    await writeOutput('data', {
      outputPath: 'out.txt',
      cwd: tempDir,
      label: 'Report',
    });
    assert.ok(stderrOutput.some((s) => s.includes('Report written to')));
  });

  it('uses default label when none provided', async () => {
    await writeOutput('data', {
      outputPath: 'out.txt',
      cwd: tempDir,
    });
    assert.ok(stderrOutput.some((s) => s.includes('Output written to')));
  });

  it('returns false for path boundary violation', async () => {
    const result = await writeOutput('data', {
      outputPath: '../../escape.txt',
      cwd: tempDir,
    });
    assert.equal(result, false);
    assert.equal(process.exitCode, 1);
    assert.ok(stderrOutput.some((s) => s.includes('Error:')));
  });
});
