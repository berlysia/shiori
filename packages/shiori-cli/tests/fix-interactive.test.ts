import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { promptFixAction, createFixReadline } from "../src/commands/fix-interactive.ts";
import type { FixAction } from "../src/commands/fix.ts";

// ── Helpers ──────────────────────────────────────────────────

function makeAction(overrides: Partial<FixAction> = {}): FixAction {
  return {
    type: "update",
    description: "Add 2 missing ref(s) to registry",
    refs: ["TEST-001", "TEST-002"],
    ...overrides,
  };
}

/**
 * Create a mock readline session using PassThrough for input.
 * PassThrough stays open so readline doesn't auto-close.
 * Use feedLine() to send one line at a time (with scheduling).
 */
function createMockSession() {
  const input = new PassThrough();
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  // Pass a separate output to readline to avoid double-writing prompt text
  const rlOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createFixReadline({ input, output: rlOutput });

  /** Write a single line to the input stream */
  function feedLine(line: string) {
    input.write(line + "\n");
  }

  /**
   * Schedule lines to be fed with delays between them.
   * Each line is written in a separate macrotask so readline has time
   * to re-issue question() between invalid inputs.
   */
  function feedLinesWithDelay(lines: string[], delayMs = 10) {
    lines.forEach((line, i) => {
      setTimeout(() => feedLine(line), delayMs * (i + 1));
    });
  }

  return { rl, output, chunks, input, feedLine, feedLinesWithDelay };
}

// ── promptFixAction ─────────────────────────────────────────

describe("promptFixAction", () => {
  it("returns approve for 'a' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("a"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "approve");
    } finally {
      rl.close();
    }
  });

  it("returns approve for 'approve' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("approve"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "approve");
    } finally {
      rl.close();
    }
  });

  it("returns skip for 's' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("s"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "skip");
    } finally {
      rl.close();
    }
  });

  it("returns skip for 'skip' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("skip"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "skip");
    } finally {
      rl.close();
    }
  });

  it("returns quit for 'q' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("q"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "quit");
    } finally {
      rl.close();
    }
  });

  it("returns quit for 'quit' input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("quit"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "quit");
    } finally {
      rl.close();
    }
  });

  it("handles case-insensitive input", async () => {
    const { rl, output, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("A"));
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "approve");
    } finally {
      rl.close();
    }
  });

  it("re-prompts on invalid input then accepts valid input", async () => {
    const { rl, output, feedLinesWithDelay } = createMockSession();
    try {
      feedLinesWithDelay(["x", "invalid", "a"]);
      const choice = await promptFixAction(makeAction(), rl, output);
      assert.equal(choice, "approve");
    } finally {
      rl.close();
    }
  });

  it("displays action details in output", async () => {
    const { rl, output, chunks, feedLine } = createMockSession();
    try {
      setImmediate(() => feedLine("a"));
      await promptFixAction(makeAction({ description: "Test action desc" }), rl, output);

      const allOutput = chunks.join("");
      assert.ok(allOutput.includes("update"), "should show action type");
      assert.ok(allOutput.includes("Test action desc"), "should show description");
      assert.ok(allOutput.includes("2 ref(s)"), "should show refs count");
    } finally {
      rl.close();
    }
  });
});
