/**
 * VS Code tasks.json template for shiori diagnostic integration.
 *
 * Generates a minimal tasks.json with check and watch tasks that
 * feed diagnostic output into VS Code's Problems panel via
 * custom problemMatcher patterns.
 *
 * Pure function — no I/O.
 */

/** Output file path for the VS Code tasks.json config */
export const VSCODE_CONFIG_PATH = '.vscode/tasks.json';

/**
 * Generate VS Code tasks.json content for shiori diagnostic integration.
 * Pure function — no I/O.
 *
 * Includes two tasks:
 * - "shiori: Check (diagnostic)" — one-shot check with problemMatcher
 * - "shiori: Watch Diagnostic (real-time)" — background watch with problemMatcher
 *
 * For the full-featured version (annotate, SARIF, jump, dashboard),
 * see: docs/recipes/vscode-tasks.json.example
 */
export function generateVscodeConfig(): string {
  return JSON.stringify(VSCODE_TASKS_CONFIG, null, 2) + '\n';
}

const PROBLEM_MATCHER_PATTERN = {
  regexp: '^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$',
  file: 1,
  line: 2,
  column: 3,
  severity: 4,
  message: 5,
  code: 6,
};

const VSCODE_TASKS_CONFIG = {
  version: '2.0.0',
  tasks: [
    {
      label: 'shiori: Check (diagnostic)',
      type: 'shell',
      command: 'pnpm shiori check --format diagnostic',
      problemMatcher: {
        owner: 'shiori',
        fileLocation: ['relative', '${workspaceFolder}'],
        pattern: PROBLEM_MATCHER_PATTERN,
      },
      presentation: {
        reveal: 'silent' as const,
        panel: 'shared' as const,
      },
    },
    {
      label: 'shiori: Watch Diagnostic (real-time)',
      type: 'shell',
      command: 'pnpm shiori watch --format diagnostic',
      isBackground: true,
      problemMatcher: {
        owner: 'shiori-watch',
        fileLocation: ['relative', '${workspaceFolder}'],
        background: {
          activeOnStart: true,
          beginsPattern: '^\\[.*\\] refreshed \\(',
          endsPattern: '^\\[.*\\] refreshed \\(',
        },
        pattern: PROBLEM_MATCHER_PATTERN,
      },
      presentation: {
        reveal: 'never' as const,
        panel: 'shared' as const,
      },
    },
  ],
};
