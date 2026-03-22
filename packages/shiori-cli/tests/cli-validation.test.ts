import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAndValidateIssueTypes,
  validateOutputFormat,
  validateProvider,
  createFormatValidator,
} from '../src/core/cli-validation.ts';
import { VERIFY_ISSUE_TYPES } from '../src/core/types.ts';
import { ExitCode } from '../src/core/exit-codes.ts';

describe('parseAndValidateIssueTypes', () => {
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderrOutput = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
  });

  it('returns empty array for undefined', () => {
    const result = parseAndValidateIssueTypes(undefined, '--fail-on');
    assert.deepEqual(result, []);
    assert.equal(process.exitCode, undefined);
  });

  it('parses valid single value', () => {
    const result = parseAndValidateIssueTypes('expired', '--fail-on');
    assert.deepEqual(result, ['expired']);
    assert.equal(process.exitCode, undefined);
  });

  it('parses valid comma-separated values', () => {
    const result = parseAndValidateIssueTypes(
      'missing-in-registry,expired',
      '--fail-on',
    );
    assert.deepEqual(result, ['missing-in-registry', 'expired']);
    assert.equal(process.exitCode, undefined);
  });

  it('trims whitespace', () => {
    const result = parseAndValidateIssueTypes(
      ' expired , syntax-error ',
      '--warn-on',
    );
    assert.deepEqual(result, ['expired', 'syntax-error']);
    assert.equal(process.exitCode, undefined);
  });

  it('returns null and sets exitCode for invalid value', () => {
    const result = parseAndValidateIssueTypes('typo', '--fail-on');
    assert.equal(result, null);
    assert.equal(process.exitCode, ExitCode.USAGE_ERROR);
    assert.ok(stderrOutput.some((s) => s.includes('"typo"')));
    assert.ok(stderrOutput.some((s) => s.includes('Valid values:')));
  });

  it('returns null for mix of valid and invalid values', () => {
    const result = parseAndValidateIssueTypes(
      'expired,invalid-type',
      '--fail-on',
    );
    assert.equal(result, null);
    assert.equal(process.exitCode, ExitCode.USAGE_ERROR);
    assert.ok(stderrOutput.some((s) => s.includes('"invalid-type"')));
  });

  it('includes flag name in error message', () => {
    parseAndValidateIssueTypes('bad', '--warn-on');
    assert.ok(stderrOutput.some((s) => s.includes('--warn-on')));
  });

  it('accepts all valid issue types', () => {
    const all = VERIFY_ISSUE_TYPES.join(',');
    const result = parseAndValidateIssueTypes(all, '--fail-on');
    assert.deepEqual(result, [...VERIFY_ISSUE_TYPES]);
    assert.equal(process.exitCode, undefined);
  });
});

describe('validateOutputFormat', () => {
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderrOutput = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
  });

  it('defaults to json for undefined', () => {
    const result = validateOutputFormat(undefined);
    assert.equal(result, 'json');
    assert.equal(process.exitCode, undefined);
  });

  it('accepts all valid formats', () => {
    for (const fmt of ['json', 'markdown', 'sarif', 'summary', 'jsonl']) {
      process.exitCode = undefined;
      const result = validateOutputFormat(fmt);
      assert.equal(result, fmt);
      assert.equal(process.exitCode, undefined);
    }
  });

  it('returns null and sets exitCode for invalid format', () => {
    const result = validateOutputFormat('xml');
    assert.equal(result, null);
    assert.equal(process.exitCode, ExitCode.USAGE_ERROR);
    assert.ok(stderrOutput.some((s) => s.includes('"xml"')));
    assert.ok(stderrOutput.some((s) => s.includes('Valid values:')));
  });
});

describe('validateProvider', () => {
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderrOutput = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
  });

  it('defaults to comment for undefined', () => {
    const result = validateProvider(undefined);
    assert.equal(result, 'comment');
    assert.equal(process.exitCode, undefined);
  });

  it('accepts comment', () => {
    const result = validateProvider('comment');
    assert.equal(result, 'comment');
    assert.equal(process.exitCode, undefined);
  });

  it('returns null and sets exitCode for unknown provider', () => {
    const result = validateProvider('foo');
    assert.equal(result, null);
    assert.equal(process.exitCode, ExitCode.USAGE_ERROR);
    assert.ok(stderrOutput.some((s) => s.includes('"foo"')));
    assert.ok(stderrOutput.some((s) => s.includes('Valid values:')));
  });
});

describe('createFormatValidator', () => {
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderrOutput = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
  });

  it('uses first format as default when value is undefined', () => {
    const validate = createFormatValidator(['json', 'markdown'] as const);
    const result = validate(undefined);
    assert.equal(result, 'json');
    assert.equal(process.exitCode, undefined);
  });

  it('uses custom default when specified', () => {
    const validate = createFormatValidator(
      ['json', 'summary'] as const,
      'summary',
    );
    const result = validate(undefined);
    assert.equal(result, 'summary');
    assert.equal(process.exitCode, undefined);
  });

  it('accepts valid format values', () => {
    const validate = createFormatValidator([
      'json',
      'markdown',
      'badge',
    ] as const);
    for (const fmt of ['json', 'markdown', 'badge']) {
      process.exitCode = undefined;
      const result = validate(fmt);
      assert.equal(result, fmt);
      assert.equal(process.exitCode, undefined);
    }
  });

  it('returns null and sets exitCode for invalid format', () => {
    const validate = createFormatValidator(['json', 'markdown'] as const);
    const result = validate('xml');
    assert.equal(result, null);
    assert.equal(process.exitCode, ExitCode.USAGE_ERROR);
    assert.ok(stderrOutput.some((s) => s.includes('"xml"')));
    assert.ok(stderrOutput.some((s) => s.includes('Valid values:')));
    assert.ok(stderrOutput.some((s) => s.includes('json, markdown')));
  });

  it('includes all valid formats in error message', () => {
    const validate = createFormatValidator([
      'json',
      'markdown',
      'csv',
    ] as const);
    validate('bad');
    assert.ok(stderrOutput.some((s) => s.includes('json, markdown, csv')));
  });
});
