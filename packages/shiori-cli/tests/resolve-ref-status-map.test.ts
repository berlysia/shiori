import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveRefStatusMap } from "../src/core/ref-status-providers/resolve.ts";

const FIXTURE_SCRIPT = resolve(import.meta.dirname!, "fixtures/echo-ref-status.mjs");
const REF_STATUS_CMD = `node ${FIXTURE_SCRIPT}`;

// Capture stderr output for log assertions
let stderrOutput: string[];
const originalStderrWrite = process.stderr.write;

function captureStderr() {
  stderrOutput = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrOutput.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr() {
  process.stderr.write = originalStderrWrite;
}

describe("resolveRefStatusMap", () => {
  beforeEach(() => {
    captureStderr();
  });

  afterEach(() => {
    restoreStderr();
  });

  it("returns undefined refStatuses when no provider is available", async () => {
    const result = await resolveRefStatusMap({ skipGhCli: true }, [{ ref: "SUP-1" }]);
    assert.equal(result.refStatuses, undefined);
  });

  it("returns undefined refStatuses when annotations have no refs", async () => {
    const result = await resolveRefStatusMap({ refStatusCommand: REF_STATUS_CMD }, [{ ref: "" }]);
    assert.equal(result.refStatuses, undefined);
  });

  it("returns undefined refStatuses for empty annotations", async () => {
    const result = await resolveRefStatusMap({ refStatusCommand: REF_STATUS_CMD }, []);
    assert.equal(result.refStatuses, undefined);
  });

  it("resolves ref statuses via command provider", async () => {
    // echo-ref-status.mjs marks refs containing 'CLOSED' as closed, others as open
    const result = await resolveRefStatusMap({ refStatusCommand: REF_STATUS_CMD }, [
      { ref: "SUP-1" },
      { ref: "CLOSED-2" },
      { ref: "SUP-1" }, // duplicate
    ]);

    assert.notEqual(result.refStatuses, undefined);
    assert.equal(result.refStatuses!.size, 2);
    assert.equal(result.refStatuses!.get("SUP-1"), "open");
    assert.equal(result.refStatuses!.get("CLOSED-2"), "closed");

    // Verify logging
    const logOutput = stderrOutput.join("");
    assert.ok(
      logOutput.includes("2 ref(s) resolved"),
      `Expected log to contain '2 ref(s) resolved', got: ${logOutput}`,
    );
    assert.ok(
      logOutput.includes("1 closed"),
      `Expected log to contain '1 closed', got: ${logOutput}`,
    );
  });

  it("gracefully degrades on provider failure", async () => {
    const result = await resolveRefStatusMap(
      { refStatusCommand: "nonexistent-command-that-does-not-exist" },
      [{ ref: "SUP-1" }],
    );

    assert.equal(result.refStatuses, undefined);

    // Verify warning logged
    const logOutput = stderrOutput.join("");
    assert.ok(
      logOutput.includes("Warning: ref-status provider"),
      `Expected warning in log, got: ${logOutput}`,
    );
  });

  it("deduplicates refs from annotations", async () => {
    const result = await resolveRefStatusMap({ refStatusCommand: REF_STATUS_CMD }, [
      { ref: "SUP-1" },
      { ref: "SUP-2" },
      { ref: "SUP-1" }, // duplicate
      { ref: "SUP-3" },
      { ref: "SUP-2" }, // duplicate
    ]);

    assert.notEqual(result.refStatuses, undefined);
    // Should have exactly 3 unique refs
    assert.equal(result.refStatuses!.size, 3);
  });
});
