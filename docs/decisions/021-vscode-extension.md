---
status: Proposed
deps:
  - 9
  - 12
  - 20
---

# ADR 021: VSCode 拡張機能

## Context

shiori は CLI ツールとして CI やターミナルでの利用を主眼に設計されてきた。一方で、開発者が日常的にコードを書く場はエディタであり、以下のペインポイントがある。

### 開発者体験の課題

1. **アノテーションの不可視性**: `shiori:` アノテーションはソースコード上のただのコメントであり、レジストリとの関連性やメタデータ（期限、担当者、理由）がエディタ上で見えない
2. **ワークフローの断絶**: アノテーションを書く→ CLI で `shiori verify` を実行する→問題を確認する→エディタに戻る、というコンテキストスイッチが発生する
3. **候補の見落とし**: `shiori candidates` で検出できる未追跡の lint disable コメントが、エディタ上では何のフィードバックもない
4. **参照の不便さ**: `shiori show <ref>` で得られる情報（レジストリエントリ、ソース位置、外部 URL）にアクセスするために毎回ターミナルに切り替える必要がある

### 既存の設計資産

ADR 009（show コマンド）と ADR 020（パッケージ exports）で、エディタ拡張からの利用を想定した API が既に設計されている。

```
exports:
  "."                  → 型定義（ShioriAnnotation, Registry 等）
  "./core/ref-pattern" → ref パターンマッチユーティリティ
  "./commands/show"    → プログラマティックな ref 検索
```

これらの API を活用する VSCode 拡張機能を構築する。

## Decision

### VSCode 拡張機能を開発する

shiori の既存 CLI・API を活用した VSCode 拡張機能を開発し、エディタ内でアノテーションの可視化・検証・操作を可能にする。

### アーキテクチャ: CLI 呼び出し + 公開 API のハイブリッド

#### 選択: CLI spawning を基盤、公開 API を補助的に使用

```
VSCode Extension
├── Diagnostics Provider     ← shiori check --format json (CLI spawn)
├── Hover Provider           ← show() 関数 (公開 API import)
├── CodeLens Provider        ← show() 関数 (公開 API import)
├── Document Link Provider   ← resolveRefUrl() (公開 API import)
├── Code Action Provider     ← 拡張内ロジック
└── File Watcher             ← workspace.onDidSaveTextDocument
```

**CLI spawning を基盤とする理由**:

- scan/verify は設定ファイル解決、glob 展開、プロバイダ初期化など複雑な前処理を含む。これらは CLI が既に正しく処理しており、再実装はバグの温床になる
- CLI の `--format json` 出力は安定した契約として扱える
- shiori のバージョンアップに対して拡張機能側の追従コストが低い
- ユーザーのプロジェクトにインストールされた shiori バージョンをそのまま使える

**公開 API を補助的に使う理由**:

- `show()` と `resolveRefUrl()` は純粋関数であり、ファイル I/O を含まない。ホバーや CodeLens など低レイテンシが求められる操作に適する
- 型定義のインポートにより型安全な開発が可能

### 機能スコープ

#### Phase 1: 基本機能（v0.1.0）

| 機能                         | 実装方式                                            | 説明                                                                |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| **インライン診断**           | `shiori check --format json` → DiagnosticCollection | verify issues をエディタ内に波線表示                                |
| **ホバー情報**               | `show()` API                                        | `shiori:` アノテーション上のホバーでレジストリ情報を表示            |
| **ドキュメントリンク**       | `resolveRefUrl()` API                               | ref を外部 URL（JIRA、GitHub Issue 等）へのクリック可能リンクに変換 |
| **ファイル保存時の自動検証** | File Watcher + CLI spawn                            | 保存時に該当ファイルの診断を更新                                    |

#### Phase 2: 生産性向上（v0.2.0）

| 機能                              | 実装方式                                                      | 説明                                                             |
| --------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| **候補ハイライト**                | `shiori candidates --format json`                             | 未追跡の lint disable コメントを情報レベルで表示                 |
| **Quick Fix: アノテーション追加** | Code Action Provider                                          | 候補に対して `shiori:` アノテーションを挿入する Quick Fix を提供 |
| **CodeLens**                      | `show()` API                                                  | アノテーション行の上に ref 情報（期限、担当者）を表示            |
| **Go to Definition**              | アノテーション → レジストリファイル内の該当エントリへジャンプ |

#### Phase 3: ワークフロー統合（v0.3.0 以降で検討）

| 機能                   | 説明                                                       |
| ---------------------- | ---------------------------------------------------------- |
| **ステータスバー**     | ワークスペース全体のアノテーション数・期限切れ数を常時表示 |
| **TreeView**           | サイドバーでレジストリ全体をブラウズ                       |
| **レジストリ編集補助** | レジストリ JSON/YAML のスキーマ補完・バリデーション        |

### 診断の重大度マッピング

shiori の verify issue type を VSCode の DiagnosticSeverity にマッピングする。

```typescript
const severityMap: Record<string, vscode.DiagnosticSeverity> = {
  expired: vscode.DiagnosticSeverity.Error,
  'missing-in-registry': vscode.DiagnosticSeverity.Warning,
  'syntax-error': vscode.DiagnosticSeverity.Error,
  'unused-in-source': vscode.DiagnosticSeverity.Warning, // レジストリファイル上に表示
};
```

候補（candidates）は `DiagnosticSeverity.Information` で表示する。

### CLI の発見と実行

拡張機能は以下の順序で shiori CLI を探索する。

1. 拡張機能設定 `shiori.executablePath`（ユーザー指定）
2. ワークスペースの `node_modules/.bin/shiori`（ローカルインストール）
3. `$PATH` 上の `shiori`（グローバルインストール）

見つからない場合は診断機能を無効化し、ステータスバーで通知する。

### キャッシュ戦略

```
┌─ レジストリ ─────────────────────────────┐
│ 読み込み: 拡張機能起動時 + FileWatcher    │
│ 保持: メモリキャッシュ（Map<ref, entry>）│
│ 更新: レジストリファイル変更時に再読み込み │
└──────────────────────────────────────────┘

┌─ 診断結果 ──────────────────────────────┐
│ 更新トリガー: ファイル保存時             │
│ スコープ: 変更ファイルのみ（差分更新）    │
│ 全体更新: コマンドパレットから手動実行    │
└──────────────────────────────────────────┘
```

ファイル保存ごとにワークスペース全体の `shiori check` を実行するのは重いため、変更ファイルの診断のみを差分更新する。全体更新はコマンドパレット (`Shiori: Verify Workspace`) からの手動実行とする。

### リポジトリ構成

```
shiori/
├── packages/
│   ├── core/          ← 既存の shiori CLI（移動）
│   └── vscode/        ← VSCode 拡張機能（新規）
│       ├── src/
│       │   ├── extension.ts
│       │   ├── diagnostics.ts
│       │   ├── hover.ts
│       │   ├── links.ts
│       │   └── cli-runner.ts
│       ├── package.json    ← contributes, activationEvents
│       └── tsconfig.json
├── package.json       ← pnpm workspace
└── pnpm-workspace.yaml
```

monorepo 化により、CLI と拡張機能を同一リポジトリで管理する。拡張機能から `@berlysia/shiori` の公開 API を `workspace:*` で参照できる。

## Alternatives Considered

### A. Language Server Protocol (LSP) を採用

- 利点: エディタ非依存（Neovim, Emacs 等でも利用可能）、標準化されたプロトコル
- 欠点: v0.0.1 の段階で LSP サーバーを実装するのは過剰。shiori のユーザーベースが VSCode 以外に広がった段階で検討すべき
- 判断: Phase 1 では VSCode 拡張として実装し、需要が確認できた段階で LSP への移行を検討する。`show()` のような純粋関数ベースの設計は LSP 移行時にもそのまま活用できる

### B. CLI spawning のみ（公開 API 不使用）

- 利点: shiori パッケージへの依存なし。CLI 出力のみに依存するため疎結合
- 欠点: ホバーや CodeLens のたびに CLI プロセスを起動するとレイテンシが大きい。`show()` は純粋関数であり、インプロセスで呼べば数 ms で完了する
- 判断: 診断はバッチ処理として CLI を使い、インタラクティブな操作（ホバー、リンク）は公開 API を使うハイブリッドが最適

### C. 公開 API のみ（CLI 不使用）

- 利点: プロセス起動のオーバーヘッドなし
- 欠点: scan/verify の前処理（設定解決、glob 展開、プロバイダ初期化）を拡張機能側で再実装する必要がある。CLI とのロジック重複がバグの温床になる
- 判断: scan/verify は CLI 経由が適切。公開 API は純粋関数に限定して使用

### D. 別リポジトリで開発

- 利点: リリースサイクルが独立、CI が軽量
- 欠点: 公開 API の変更に対する追従が遅れる。開発初期は同一リポジトリの方が変更を同期しやすい
- 判断: monorepo で開始し、拡張機能が安定したら分離を検討

## Consequences

### 変更されるもの

- リポジトリ構成: フラット → pnpm workspace monorepo
- 既存の shiori CLI コードを `packages/core/` に移動

### 追加されるもの

- `packages/vscode/`: VSCode 拡張機能パッケージ
- `pnpm-workspace.yaml`: ワークスペース定義
- CI: 拡張機能のビルド・テストジョブ

### 他 ADR への影響

- **ADR 020**: monorepo 化に伴い CI ワークフローの構成が変わる。拡張機能のビルド・パッケージングジョブを追加
- **ADR 009**: `show()` の出力形式が拡張機能の表示に直結するため、変更時は拡張機能への影響を確認する必要がある
- **ADR 012**: ref パターン解決が拡張機能のドキュメントリンク機能の基盤になる

### リスク

- **monorepo 化のコスト**: 既存の CI・ビルド設定の移行が必要。ただし v0.0.1 で外部ユーザーがいないため、破壊的変更のリスクは低い
- **CLI 出力形式の安定性**: 拡張機能が `--format json` の出力形式に依存するため、出力形式の変更は拡張機能の破壊につながる。出力形式を内部契約として扱い、変更時は拡張機能のテストで検知する
