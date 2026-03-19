import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  ScanResult,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  ReportResult,
} from "../src/core/types.ts";
import { buildPrescriptions } from "../src/commands/prescriptions.ts";
import { report } from "../src/commands/report.ts";

function makeAnnotation(overrides: Partial<ShioriAnnotation> = {}): ShioriAnnotation {
  return {
    ref: "TEST-001",
    rule: "no-console",
    tagged: true,
    ignored: false,
    location: { file: "test.ts", line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    reason: "test reason",
    target: "test.ts",
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

function makeReport(options: {
  annotations?: ShioriAnnotation[];
  candidates?: ShioriCandidate[];
  registry?: Record<string, RegistryEntry>;
  now?: Date;
}): ReportResult {
  return report({
    scanResult: makeScanResult(options.annotations ?? [], options.candidates ?? []),
    registry: options.registry ?? {},
    failOn: [],
    warnOn: [],
    now: options.now,
  });
}

describe("buildPrescriptions", () => {
  it("returns empty array for healthy codebase", () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: "TEST-001" })],
      registry: { "TEST-001": makeRegistryEntry() },
    });

    const prescriptions = buildPrescriptions(reportResult);
    assert.equal(prescriptions.length, 0);
  });

  it("generates critical prescription for expired annotations", () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: "EXP-001" })],
      registry: { "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }) },
    });

    const prescriptions = buildPrescriptions(reportResult);
    assert.ok(prescriptions.length > 0);

    const expired = prescriptions.find((p) => p.message.includes("expired"));
    assert.ok(expired, "should have expired prescription");
    assert.equal(expired.urgency, "critical");
    assert.ok(expired.scoreImpact > 0);
    assert.ok(expired.command.length > 0);
    assert.equal(expired.actionType, "triage");
  });

  it("generates recommended prescription for missing-in-registry", () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: "MISS-001" })],
      registry: {},
    });

    const prescriptions = buildPrescriptions(reportResult);
    const missing = prescriptions.find((p) => p.message.includes("missing-in-registry"));
    assert.ok(missing, "should have missing-in-registry prescription");
    assert.equal(missing.urgency, "recommended");
    assert.equal(missing.command, "shiori update");
    assert.equal(missing.actionType, "update");
  });

  it("generates suggestion for candidates", () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: "TEST-001" })],
      candidates: [
        {
          pattern: "eslint",
          rule: "no-unused-vars",
          location: { file: "a.ts", line: 1 },
          directive: "eslint-disable-next-line",
        },
      ],
      registry: { "TEST-001": makeRegistryEntry() },
    });

    const prescriptions = buildPrescriptions(reportResult);
    const candidateRx = prescriptions.find((p) => p.message.includes("untracked"));
    assert.ok(candidateRx, "should have candidate prescription");
    assert.equal(candidateRx.urgency, "suggestion");
    assert.equal(candidateRx.command, "shiori candidates");
    assert.equal(candidateRx.actionType, "candidates");
  });

  it("sorts prescriptions by score impact descending", () => {
    const reportResult = makeReport({
      annotations: [
        makeAnnotation({ ref: "EXP-001" }),
        makeAnnotation({ ref: "MISS-001" }),
        makeAnnotation({ ref: "MISS-002" }),
      ],
      registry: {
        "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }),
      },
    });

    const prescriptions = buildPrescriptions(reportResult);
    assert.ok(prescriptions.length >= 2);

    // Verify descending order
    for (let i = 1; i < prescriptions.length; i++) {
      assert.ok(
        prescriptions[i - 1]!.scoreImpact >= prescriptions[i]!.scoreImpact,
        `prescription ${i - 1} (${prescriptions[i - 1]!.scoreImpact}) should have >= impact than ${i} (${prescriptions[i]!.scoreImpact})`,
      );
    }
  });

  it("generates suggestion for expiring-soon", () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: "SOON-001" })],
      registry: {
        "SOON-001": makeRegistryEntry({ expires: "2026-02-20" }),
      },
      now: new Date("2026-02-11T00:00:00Z"),
    });

    const prescriptions = buildPrescriptions(reportResult);
    const expiringSoon = prescriptions.find((p) => p.message.includes("expiring-soon"));
    assert.ok(expiringSoon, "should have expiring-soon prescription");
    assert.equal(expiringSoon.urgency, "suggestion");
  });

  it("caps score impact at tier maximum", () => {
    // 5 expired annotations → 50 raw deduction, capped at 40
    const annotations = Array.from({ length: 5 }, (_, i) => makeAnnotation({ ref: `EXP-${i}` }));
    const registry: Record<string, RegistryEntry> = {};
    for (const a of annotations) {
      registry[a.ref] = makeRegistryEntry({ expires: "2020-01-01" });
    }

    const reportResult = makeReport({ annotations, registry });
    const prescriptions = buildPrescriptions(reportResult);
    const expired = prescriptions.find((p) => p.message.includes("expired"));
    assert.ok(expired);
    // Impact should be capped at 40 (the tier max)
    assert.ok(expired.scoreImpact <= 40);
  });
});
