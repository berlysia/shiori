---
status: Proposed
deps:
  - 10
  - 12
  - 13
---

# ADR 022: モノレポ横断ガバナンスモード (`--workspace`)

## Context

### 現状の制約

shiori の scan/check/health コマンドは**単一ルートディレクトリ**を前提に設計されている。`scan()` は 1 つの `cwd` と 1 セットの glob パターンを受け取り、`ScanResult` を返す。

モノレポ環境（pnpm workspaces, Turborepo, Nx 等）では以下の課題がある：

1. **ルートからの一括実行ができない**: 各パッケージに `cd` して個別に `shiori check` を実行する必要がある
2. **パッケージ横断の健全性が見えない**: 15 パッケージのモノレポで「最も健全性が低いパッケージ」を特定する手段がない
3. **CI 統合が煩雑**: パッケージごとのワークフロー分岐が必要で、導入コストが高い

### 既存アーキテクチャの強み

現行アーキテクチャには workspace 対応を低コストで実現できる構造的基盤がある：

- **scan() は pure async function**: `ScanResult` は配列の concat + `filesScanned` の加算でマージ可能
- **verify/report/health/triage は pure sync function**: 入力として `ScanResult` と `Registry` を受け取り、I/O を行わない
- **CLI wrapper / pure logic 分離**: 新しいオーケストレーションは CLI 層のみで完結可能
- **Multi-registry (ADR 010)**: namespace ベースのレジストリ分割が既に動作中

### ユーザーストーリー

**US-1: パッケージ別 issue 一覧**

> 15 パッケージのモノレポのルートで `shiori check --workspace` を実行し、パッケージごとの issue 一覧を確認して、どのパッケージに注意が必要かを把握したい。

**US-2: パッケージ別スコア比較**

> `shiori health --workspace` を実行して、パッケージ別のガバナンススコア一覧と最悪パッケージの特定を行い、改善の優先順位を決定したい。

## Decision

### 基本方針: CLI 層のみで workspace を解決

**pure logic 層（verify, report, health, triage）は一切変更しない。** workspace の解決・パッケージ別スキャン・結果のマージは CLI 層のオーケストレーションとして実装する。

```
shiori check --workspace
  → detectWorkspaces(cwd)             ← 新規: core/workspace.ts
  → packages.map(pkg => scan({cwd: pkg.dir, ...}))  ← 既存 scan() の再利用
  → mergeScanResults(results)          ← 新規: core/workspace.ts
  → check(mergedResult)               ← 既存 check() の再利用
  → formatWithPackageBreakdown(result) ← CLI 層のフォーマット拡張
```

この方針により：

- pure logic 層のテスト・型・合成パターンに**影響ゼロ**
- dependency-cruiser ルールの変更が**不要**
- 既存コマンドの動作に**副作用なし**

### パッケージ検出: 自前軽量実装

外部ライブラリ（`@manypkg/get-packages` 等）は使用しない。shiori の依存は現在 fast-glob, gunshi, yaml の 3 つのみであり、検出に必要な情報はこれらで十分にカバーできる。

```typescript
// src/core/workspace.ts

export interface WorkspacePackage {
  /** パッケージ名 (package.json#name) */
  name: string;
  /** ルートからの相対パス */
  dir: string;
}

export interface WorkspaceDetectionResult {
  /** 検出されたパッケージ一覧 */
  packages: WorkspacePackage[];
  /** ワークスペースルートパス */
  root: string;
  /** 検出ソース */
  source: 'pnpm-workspace' | 'npm-workspaces' | 'nx' | 'turbo';
}

/**
 * ワークスペースルートからパッケージ一覧を検出する。
 * 検出優先順位:
 *   1. pnpm-workspace.yaml (packages フィールドの glob 展開)
 *   2. package.json#workspaces (npm/yarn workspaces)
 *   3. nx.json の存在 + packages/apps 規約
 *   4. turbo.json の存在 + package.json#workspaces
 *
 * 検出できない場合は空配列を返す（エラーにしない）。
 */
export async function detectWorkspaces(
  cwd: string,
): Promise<WorkspaceDetectionResult | null>;
```

検出ロジック：

- `pnpm-workspace.yaml`: 既存の `yaml` パッケージで YAML パース → `packages` フィールドの glob パターンを fast-glob で展開
- `package.json#workspaces`: JSON parse → glob 展開
- `nx.json` / `turbo.json`: JSON parse → 存在確認のみ（パッケージリストは `package.json#workspaces` にフォールバック）

### Scan 集約: パッケージ別 scan() + マージ

パッケージごとに `scan()` を呼び、結果をマージする。glob パターン統合は行わない。

```typescript
// src/core/workspace.ts

export interface PackageScanResult {
  /** パッケージ名 */
  package: string;
  /** パッケージルートからの相対パス */
  dir: string;
  /** scan() の結果 */
  scanResult: ScanResult;
}

export interface WorkspaceScanResult {
  /** パッケージ別の結果 */
  packages: PackageScanResult[];
  /** 全パッケージの統合結果（verify/report/health に渡す） */
  merged: ScanResult;
}

/**
 * 全パッケージに対して scan() を実行し、結果をマージする。
 *
 * 各パッケージの scan() は独立した cwd で実行される。
 * location.file は `<package-dir>/<relative-path>` として正規化される。
 */
export async function scanWorkspaces(
  packages: WorkspacePackage[],
  scanOptions: Omit<ScanOptions, 'cwd'>,
): Promise<WorkspaceScanResult>;
```

**マージ戦略**:

- `annotations`: 全パッケージの配列を concat → `location.file` をルート相対パスに変換（`<pkg.dir>/<file>`）→ ソート
- `candidates`: 同上
- `filesScanned`: 加算

**並列実行**: `Promise.all(packages.map(...))` でパッケージ間を並列化。既存の scan 内 batch（20 ファイル並列）との組み合わせにより、I/O スループットを最大化する。

### レポート出力: パッケージ別ブレイクダウン

`check --workspace` と `health --workspace` の出力に、パッケージ別の集計セクションを追加する。

**check --workspace (JSON 出力例)**:

```json
{
  "workspace": true,
  "packages": [
    {
      "name": "@myapp/core",
      "dir": "packages/core",
      "issues": 3,
      "errors": 1,
      "warnings": 2
    },
    {
      "name": "@myapp/ui",
      "dir": "packages/ui",
      "issues": 0,
      "errors": 0,
      "warnings": 0
    }
  ],
  "verifyResult": { "...": "...（既存の統合 VerifyResult）" }
}
```

**health --workspace (summary 出力例)**:

```
┌─────────────────────────────────────┐
│ 🏥 Workspace Health: 72/100        │
├─────────────────────────────────────┤
│ Packages: 5 scanned                │
│ Issues: 8 total (3 errors)         │
├─────────────────────────────────────┤
│ Package Scores:                     │
│   @myapp/ui ............ 95 ✅      │
│   @myapp/api ........... 82 ✅      │
│   @myapp/core .......... 65 ⚠️      │
│   @myapp/auth .......... 45 🔴      │
│   @myapp/legacy ........ 32 🔴      │
│                                     │
│ 💡 Worst: @myapp/legacy (32/100)   │
│    Run: shiori health --cwd packages/legacy │
└─────────────────────────────────────┘
```

### Registry 戦略

v0.2.0 では**ルートの registry を全パッケージで共有**する。パッケージ固有 registry は非スコープとする。

理由：

- 既存の multi-registry (ADR 010/012) は namespace ベースの分割であり、パッケージベースの分割とは直交する
- パッケージ固有 registry を導入すると、`loadConfigAndRegistry()` のパス解決ロジックに大幅な変更が必要
- ルート共有 registry で十分な価値が得られる（パッケージ横断の一覧性が主目的）

### Config 拡張

`ShioriConfig` にワークスペース関連のフィールドは**追加しない**。`--workspace` フラグは CLI 引数としてのみ存在し、config ファイルからの設定は将来の拡張とする。

### dependency-cruiser ルール

pure logic 層を変更しないため、既存ルールの変更は不要。`core/workspace.ts` は core 層の新規モジュールとして追加され、commands/ や formatters/ への依存を持たない。

## Out of Scope (v0.2.0 で実施しない)

以下は明示的に非スコープとし、将来の ADR で別途設計する：

1. **パッケージ固有 config**: 各パッケージに `.config/shiori/config.yaml` を置くパターン。ルートの config を全パッケージで共有する
2. **パッケージ固有 registry**: パッケージごとの registry ファイル分割。ルート registry を共有する
3. **`--workspace` 以外のコマンドへの拡張**: `triage --workspace`, `report --workspace`, `delta --workspace` 等。check と health の 2 コマンドに限定する
4. **ワークスペースグラフ解析**: パッケージ間の依存関係に基づくガバナンス伝播（例: 依存先の expired が依存元に影響）
5. **パッケージフィルタリング**: `--workspace --filter @myapp/core` のようなパッケージ限定実行
6. **パッケージ別 trend**: パッケージ単位のスコア時系列追跡
7. **パッケージ別 CI exit code**: パッケージごとの pass/fail 判定（全体の統合結果で判定）
8. **Lerna / Rush 対応**: pnpm-workspace.yaml, package.json#workspaces, nx.json, turbo.json の 4 ソースに限定
9. **workspace 設定の config ファイル化**: `workspace.packages` を config.yaml に記載するパターン
10. **パッケージヒートマップ可視化**: パッケージ間のガバナンス状態をビジュアルに表示する機能

## Alternatives Considered

### A: pure logic 層にパッケージ概念を追加

`ScanResult`, `VerifyResult`, `ReportResult` にパッケージフィールドを追加し、verify/report/health 内でパッケージ別集計を行う。

**却下理由**:

- 21 の既存コマンドすべてに影響する型変更
- verify() の 280 行のロジックにパッケージ分岐が入り複雑化
- 単一パッケージでの使用時に不要なオーバーヘッド
- テストの大規模修正が必要

### B: 外部ライブラリ（@manypkg/get-packages）でパッケージ検出

**却下理由**:

- Changesets エコシステムへの依存が増加（現在の依存 3 → 推定 10+）
- shiori が必要なのは「ディレクトリリスト」のみであり、パッケージマネージャーの自動検出等の高機能は不要
- `yaml`（既存依存）+ `fast-glob`（既存依存）で 50-80 行で実装可能

### C: glob パターン統合による単一 scan

ルートから `packages/*/src/**/*.ts` のように glob パターンを統合し、1 回の `scan()` で全パッケージを処理する。

**却下理由**:

- `location.file` が `packages/foo/src/bar.ts` のようなルート相対パスになり、パッケージ固有の相対パスセマンティクスが失われる
- fast-glob の `cwd` / `ignore` の挙動がパッケージ横断で不安定になるリスク
- パッケージごとの config（将来拡張）に対応できない
- パッケージ別集計がファイルパスのプレフィックスマッチに依存し、脆い

## Implementation Plan

### Phase 1: core/workspace.ts（見積: small）

1. `WorkspacePackage`, `WorkspaceDetectionResult` 型定義
2. `detectWorkspaces()` 実装（pnpm-workspace.yaml, package.json#workspaces）
3. `PackageScanResult`, `WorkspaceScanResult` 型定義
4. `scanWorkspaces()` 実装（パッケージ別 scan + マージ）
5. テスト: 検出・マージ・パス正規化

### Phase 2: check --workspace（見積: small）

1. `check-cli.ts` に `--workspace` フラグ追加
2. workspace 検出 → scanWorkspaces → check → 出力の拡張
3. JSON 出力にパッケージ別集計を追加
4. テスト: フラグ解析・出力形式

### Phase 3: health --workspace（見積: small）

1. `health-cli.ts` に `--workspace` フラグ追加
2. workspace 検出 → scanWorkspaces → パッケージ別 report → 全体 health
3. summary 出力にパッケージ別スコア一覧を追加
4. テスト: パッケージ別スコア計算・最悪パッケージ特定

### 見積合計: medium（Phase 1-3 で 3-5 日）

## Risks

1. **パフォーマンス**: 15 パッケージ × 数千ファイルで scan のメモリ・時間が問題になる可能性。Promise.all の並列度調整で対応可能
2. **パス正規化**: パッケージディレクトリの相対パスからルート相対パスへの変換でエッジケース（symlink, nested workspaces）が発生する可能性
3. **config の不整合**: ルート config の scanPatterns がパッケージ固有のファイル構成に合わない場合がある（非スコープのパッケージ固有 config で将来対応）

## References

- ADR 010: Multi-Registry Loading（namespace ベースの分割）
- ADR 012: Pattern-based Ref Resolution（refPatterns による registry ルーティング）
- ADR 013: CLI Ergonomics（コマンド引数の設計規約）
- EP-0038: モノレポ横断ガバナンスモード（元の Enhancement Proposal）
