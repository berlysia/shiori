/**
 * Sparkline rendering utilities.
 *
 * Produces Unicode block-character sparklines for terminal display.
 * Shared by trend (governance score history) and journal-velocity
 * (operation flow over time).
 */

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Map a numeric value to a sparkline block character.
 * Linearly maps the value within [min, max] to one of 8 block levels.
 * When min === max (flat line), returns the middle block (▆).
 */
export function valueToBlock(value: number, min: number, max: number): string {
  if (min === max) return SPARK_BLOCKS[5]!;
  const ratio = (value - min) / (max - min);
  // Clamp to [0, 7] and pick the corresponding block
  const index = Math.min(7, Math.max(0, Math.round(ratio * 7)));
  return SPARK_BLOCKS[index]!;
}

/**
 * Build a sparkline string from an array of numeric values.
 * Computes min/max from the values and maps each to a block character.
 */
export function buildSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((v) => valueToBlock(v, min, max)).join('');
}
