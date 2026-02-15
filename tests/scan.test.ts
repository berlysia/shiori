import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ShioriAnnotation,
  ShioriCandidate,
} from '../src/core/types.ts';
import {
  formatScanResultForDisplay,
  type ScanResult,
} from '../src/commands/scan.ts';

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    ignored: false,
    location: { file: 'src/test.ts', line: 10 },
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ShioriCandidate> = {},
): ShioriCandidate {
  return {
    pattern: 'lint-disable',
    rule: '@typescript-eslint/no-explicit-any',
    location: { file: 'src/utils.ts', line: 5 },
    ...overrides,
  };
}

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    annotations: [],
    candidates: [],
    filesScanned: 10,
    ...overrides,
  };
}

describe('formatScanResultForDisplay', () => {
  it('shows annotations and candidates', () => {
    const result = makeScanResult({
      filesScanned: 42,
      annotations: [
        makeAnnotation({
          ref: 'SUP-1234',
          rule: 'no-console',
          expires: '2026-06',
          location: { file: 'src/auth.ts', line: 15 },
        }),
        makeAnnotation({
          ref: 'ADR:0007',
          rule: undefined,
          location: { file: 'src/config.ts', line: 3 },
        }),
      ],
      candidates: [
        makeCandidate({
          pattern: 'lint-disable',
          rule: '@typescript-eslint/no-explicit-any',
          location: { file: 'src/utils.ts', line: 10 },
        }),
      ],
    });

    const output = formatScanResultForDisplay(result, 'scan-result.json');

    assert.ok(output.includes('Scanned 42 files'));
    assert.ok(output.includes('Annotations (2):'));
    assert.ok(output.includes('SUP-1234'));
    assert.ok(output.includes('src/auth.ts:15'));
    assert.ok(output.includes('no-console'));
    assert.ok(output.includes('expires=2026-06'));
    assert.ok(output.includes('ADR:0007'));
    assert.ok(output.includes('src/config.ts:3'));
    assert.ok(output.includes('Candidates (1):'));
    assert.ok(output.includes('src/utils.ts:10'));
    assert.ok(output.includes('lint-disable'));
    assert.ok(output.includes('@typescript-eslint/no-explicit-any'));
    assert.ok(output.includes('Saved to scan-result.json'));
  });

  it('omits Annotations section when empty', () => {
    const result = makeScanResult({
      annotations: [],
      candidates: [makeCandidate()],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(!output.includes('Annotations'));
    assert.ok(output.includes('Candidates (1):'));
  });

  it('omits Candidates section when empty', () => {
    const result = makeScanResult({
      annotations: [makeAnnotation()],
      candidates: [],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(output.includes('Annotations (1):'));
    assert.ok(!output.includes('Candidates'));
  });

  it('omits both sections when both empty', () => {
    const result = makeScanResult({
      filesScanned: 5,
      annotations: [],
      candidates: [],
    });

    const output = formatScanResultForDisplay(result);

    assert.equal(output, 'Scanned 5 files');
  });

  it('omits Saved line when savedTo is not provided', () => {
    const result = makeScanResult({
      annotations: [makeAnnotation()],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(!output.includes('Saved to'));
  });

  it('shows Saved line when savedTo is provided', () => {
    const result = makeScanResult({
      annotations: [makeAnnotation()],
    });

    const output = formatScanResultForDisplay(
      result,
      '.config/shiori/scan-result.json',
    );

    assert.ok(output.includes('Saved to .config/shiori/scan-result.json'));
  });

  it('shows draft annotations with (draft) label', () => {
    const result = makeScanResult({
      annotations: [makeAnnotation({ ref: '' })],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(output.includes('(draft)'));
  });

  it('shows reason field in annotation', () => {
    const result = makeScanResult({
      annotations: [
        makeAnnotation({ ref: 'DEV-001', reason: 'workaround for X' }),
      ],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(output.includes('reason=workaround for X'));
  });

  it('shows candidate with text (todo pattern)', () => {
    const result = makeScanResult({
      candidates: [
        makeCandidate({
          pattern: 'todo',
          rule: undefined,
          text: 'Fix this later',
          location: { file: 'src/api.ts', line: 22 },
        }),
      ],
    });

    const output = formatScanResultForDisplay(result);

    assert.ok(output.includes('src/api.ts:22'));
    assert.ok(output.includes('todo'));
    assert.ok(output.includes('Fix this later'));
  });
});
