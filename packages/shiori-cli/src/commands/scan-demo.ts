/**
 * Demo orchestration for `shiori scan --demo`.
 *
 * Generates sample source files and a demo registry in a temporary directory,
 * runs the scan → verify → health pipeline, and displays the results
 * so that first-time users can experience shiori's value without real files.
 *
 * Follows the starter.ts template-literal embedding pattern (no external fixtures).
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from './scan.ts';
import { verify } from './verify.ts';
import { report } from './report.ts';
import { buildHealthResult } from './health.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import type {
  Registry,
  ScanResult,
  VerifyResult,
  HealthLevel,
  DemoResult,
} from '../core/types.ts';
import { saveRegistry } from '../core/registry.ts';
import { healthEmoji } from '../core/emoji.ts';

// ---------------------------------------------------------------------------
// Demo fixtures (template literals — no external files)
// ---------------------------------------------------------------------------

interface DemoFile {
  /** Relative path within the demo directory */
  path: string;
  /** File content */
  content: string;
}

/** Demo source files covering the 3 annotation classification paths */
function getDemoFiles(): DemoFile[] {
  return [
    {
      path: 'src/api-client.ts',
      content: `// API client with a temporary console.log for debugging
// eslint-disable-next-line no-console -- shiori: DEMO-001 reason=debug-logging expires=2025-12-31
console.log('API response:', data);
`,
    },
    {
      path: 'src/theme.css',
      content: `/* Brand color override — named color used for legacy browser compatibility */
/* stylelint-disable-next-line color-named -- shiori: DEMO-002 reason=legacy-compat */
.brand-header { color: navy; }
`,
    },
    {
      path: 'src/config.ts',
      content: `// Architecture decision: env-based config loading
// shiori: DEMO-003 reason=ADR-approved
const CONFIG_PATH = process.env.CONFIG_PATH ?? './config.json';
export { CONFIG_PATH };
`,
    },
  ];
}

/** Demo registry with 3 entries — DEMO-001 has a past expiration date */
function getDemoRegistry(): Registry {
  return {
    'DEMO-001': {
      reason: 'Temporary debug logging during API integration',
      target: 'src/api-client.ts',
      expires: '2025-12-31',
      ticket: undefined,
      owner: 'platform-team',
      notes: 'Remove after API stabilization',
      kind: 'workaround',
    },
    'DEMO-002': {
      reason: 'Legacy browser compatibility — named color fallback',
      target: 'src/theme.css',
      expires: undefined,
      ticket: undefined,
      owner: 'frontend-team',
      notes: 'Re-evaluate when dropping IE11 support',
      kind: 'compat',
    },
    'DEMO-003': {
      reason: 'Environment-based config loading per ADR-015',
      target: 'src/config.ts',
      expires: undefined,
      ticket: undefined,
      owner: 'infra-team',
      notes: 'Approved architectural decision',
      kind: 'design-decision',
    },
  };
}

// Re-export DemoResult from core/types.ts for backward compatibility
export type { DemoResult } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Demo orchestration
// ---------------------------------------------------------------------------

/**
 * Run the scan --demo pipeline.
 *
 * 1. Create temp directory with demo files + registry
 * 2. Scan the demo files
 * 3. Verify against demo registry
 * 4. Compute health score
 * 5. Display results with CTA
 * 6. Clean up temp directory
 */
export async function runDemo(): Promise<DemoResult> {
  const demoDir = await mkdtemp(join(tmpdir(), 'shiori-demo-'));

  try {
    // Write demo source files
    const demoFiles = getDemoFiles();
    for (const file of demoFiles) {
      const filePath = join(demoDir, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // Write demo registry
    const registry = getDemoRegistry();
    const configDir = join(demoDir, '.config', 'shiori');
    await mkdir(configDir, { recursive: true });
    const registryPath = join(configDir, 'registry.json');
    await saveRegistry(registryPath, registry);

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns: ['**/*.{ts,css}'],
      ignore: [],
      provider,
      cwd: demoDir,
    });

    // Verify
    const verifyResult = verify({
      records: scanResult.annotations,
      registry,
      failOn: ['expired', 'missing-in-registry'],
      warnOn: ['expiring-soon'],
    });

    // Health
    const reportResult = report({
      scanResult,
      registry,
      failOn: ['expired', 'missing-in-registry'],
      warnOn: ['expiring-soon'],
    });
    const healthResult = buildHealthResult(reportResult);

    return {
      scanResult,
      verifyResult,
      healthScore: healthResult.health.score,
      healthLevel: healthResult.health.level,
      demoDir,
    };
  } finally {
    // Auto-cleanup
    await rm(demoDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format the demo result for human-readable TTY output.
 * Includes scan results, verify issues, health score, and CTA.
 */
export function formatDemoResult(result: DemoResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('━━━ shiori scan --demo ━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('shiori はソースコード中の lint disable コメントや設計判断を');
  lines.push('構造化アノテーションとして追跡し、技術的負債を可視化します。');
  lines.push('');
  lines.push('このデモでは 3 つのサンプルファイルを使って動作を体験できます:');
  lines.push('');

  // Scan summary
  lines.push('── Scan Results ────────────────────────────');
  lines.push(
    `ファイル数: ${result.scanResult.filesScanned}   アノテーション数: ${result.scanResult.annotations.length}`,
  );
  lines.push('');

  for (const a of result.scanResult.annotations) {
    const ref = a.ref || '(draft)';
    const loc = `${a.location.file}:${a.location.line}`;
    const parts = [
      `  ${ref}`,
      loc,
      ...(a.rule ? [a.rule] : []),
      ...(a.expires ? [`expires=${a.expires}`] : []),
    ];
    lines.push(parts.join('   '));
  }

  // Verify issues
  if (result.verifyResult.issues.length > 0) {
    lines.push('');
    lines.push('── Verify Issues ───────────────────────────');
    for (const issue of result.verifyResult.issues) {
      const severity = issue.severity === 'error' ? '✗' : '⚠';
      lines.push(
        `  ${severity} [${issue.type}] ${issue.ref} — ${issue.message}`,
      );
    }
  }

  // Health score
  lines.push('');
  lines.push('── Health ──────────────────────────────────');
  const emoji = healthEmoji(result.healthLevel);
  lines.push(
    `${emoji} スコア: ${result.healthScore}/100 (${result.healthLevel})`,
  );

  // CTA
  lines.push('');
  lines.push('── 次のステップ ────────────────────────────');
  lines.push('  $ shiori init            # プロジェクトにレジストリを作成');
  lines.push('  $ shiori scan            # 実際のソースコードをスキャン');
  lines.push('  $ shiori health          # ガバナンス健全性を確認');
  lines.push('');
  lines.push(
    'ガイド: https://github.com/berlysia/shiori/blob/master/docs/getting-started.md',
  );
  lines.push('詳しくは: shiori docs / https://github.com/berlysia/shiori');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}
