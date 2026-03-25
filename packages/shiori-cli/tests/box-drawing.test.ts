import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayWidth,
  padEndDisplay,
  renderBox,
} from '../src/core/box-drawing.ts';

describe('displayWidth', () => {
  it('returns 0 for empty string', () => {
    assert.equal(displayWidth(''), 0);
  });

  it('counts ASCII characters as width 1', () => {
    assert.equal(displayWidth('hello'), 5);
  });

  it('counts emoji as width 2', () => {
    // 🟢 is a surrogate pair (code point > 0xFFFF)
    assert.equal(displayWidth('🟢'), 2);
  });

  it('handles mixed ASCII and emoji', () => {
    // "A🟢B" = 1 + 2 + 1 = 4
    assert.equal(displayWidth('A🟢B'), 4);
  });

  it('handles miscellaneous symbols (U+2600-U+27BF) as width 2', () => {
    // ⚪ = U+26AA, in the 0x2600-0x27BF range
    assert.equal(displayWidth('⚪'), 2);
  });
});

describe('padEndDisplay', () => {
  it('pads ASCII string to target width', () => {
    const result = padEndDisplay('hi', 5);
    assert.equal(result, 'hi   ');
    assert.equal(result.length, 5);
  });

  it('does not truncate string longer than target', () => {
    const result = padEndDisplay('hello world', 5);
    assert.equal(result, 'hello world');
  });

  it('accounts for emoji width when padding', () => {
    // "🟢" has display width 2, target width 5 → need 3 spaces
    const result = padEndDisplay('🟢', 5);
    assert.equal(displayWidth(result), 5);
  });
});

describe('renderBox', () => {
  it('returns empty string for empty sections', () => {
    assert.equal(renderBox([]), '');
  });

  it('renders single section with one line', () => {
    const result = renderBox([['Hello']]);
    assert.ok(result.includes('┌'));
    assert.ok(result.includes('└'));
    assert.ok(result.includes('Hello'));
  });

  it('renders multiple sections with dividers', () => {
    const result = renderBox([['Section 1'], ['Section 2']]);
    assert.ok(result.includes('├'));
    assert.ok(result.includes('Section 1'));
    assert.ok(result.includes('Section 2'));
  });

  it('pads all lines to the same width', () => {
    const result = renderBox([['Short', 'A much longer line']]);
    const lines = result.split('\n');
    // All bordered lines should have the same length
    const borderedLines = lines.filter((l) => l.startsWith('│'));
    const lengths = borderedLines.map((l) => l.length);
    assert.ok(lengths.every((len) => len === lengths[0]));
  });

  it('handles emoji in content lines', () => {
    const result = renderBox([['🟢 Health: 100/100']]);
    assert.ok(result.includes('🟢 Health: 100/100'));
    // Verify box is well-formed (has top and bottom borders)
    const lines = result.split('\n');
    assert.ok(lines[0]!.startsWith('┌'));
    assert.ok(lines[lines.length - 1]!.startsWith('└'));
  });
});
