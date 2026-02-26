import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScanResult, Registry } from '../src/core/types.ts';
import { check } from '../src/commands/check.ts';

const makeScanResult = (
  annotations: ScanResult['annotations'],
): ScanResult => ({
  annotations,
  candidates: [],
  filesScanned: 1,
});

describe('check', () => {
  it('returns verify result from scan result and registry', () => {
    const scanResult = makeScanResult([
      {
        ref: 'TEST-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);
    const registry: Registry = {
      'TEST-001': {
        reason: 'test',
        target: 'test.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = check({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
    });

    assert.equal(result.scanResult, scanResult);
    assert.equal(result.verifyResult.summary.total, 0);
    assert.equal(result.verifyResult.scannedRecords, 1);
    assert.equal(result.verifyResult.registryEntries, 1);
  });

  it('passes duplicates through to verify for ref-collision', () => {
    const scanResult = makeScanResult([
      {
        ref: 'DUP-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);
    const registry: Registry = {
      'DUP-001': {
        reason: 'test',
        target: 'test.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = check({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      duplicates: [
        {
          ref: 'DUP-001',
          defaultFile: 'registry.json',
          patternFile: 'team-a.json',
        },
      ],
    });

    const collisions = result.verifyResult.issues.filter(
      (i) => i.type === 'ref-collision',
    );
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0]!.ref, 'DUP-001');
    assert.equal(result.verifyResult.summary.byType['ref-collision'], 1);
  });

  it('detects missing-in-registry as error when failOn is set', () => {
    const scanResult = makeScanResult([
      {
        ref: 'UNKNOWN-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);

    const result = check({
      scanResult,
      registry: {},
      failOn: ['missing-in-registry'],
      warnOn: [],
    });

    assert.equal(result.verifyResult.summary.errors, 1);
    assert.equal(result.verifyResult.issues[0]!.type, 'missing-in-registry');
    assert.equal(result.verifyResult.issues[0]!.severity, 'error');
  });
});
