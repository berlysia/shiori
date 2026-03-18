---
status: Accepted
deps:
  - 18
  - 25
---

# ADR 026: Webhook Daemon Architecture

## Context

EP-0071 と EP-0075 により `shiori resolve --closed --format json --yes` が利用可能になった。GitHub issue の close をトリガーとして自動的にアノテーションを resolve する需要がある。

### 要件

- GitHub Webhook (issues closed) を受信し、shiori CLI を自動実行する
- shiori 本体の依存関係を増やさない（ADR 018: shiori はデータ生成器）
- Phase 1 は最小限の node:http サーバー、Phase 2 で拡張可能な設計

## Decision

### 分離パッケージとしての実装

`@berlysia/shiori-daemon` を pnpm workspace 内の独立パッケージとして実装する。

#### アーキテクチャ

```
GitHub Webhook → shiori-daemon (node:http)
                      ↓ HMAC-SHA256 検証
                      ↓ イベントパース (issues closed のみ)
                      ↓ child_process.execFile
                 shiori resolve --closed --format json --yes
                      ↓
                 JSON レスポンス返却
```

#### Phase 1 (本 ADR のスコープ): node:http

- `node:http` による最小限の HTTP サーバー
- 外部依存ゼロ（Node.js 標準ライブラリのみ）
- POST `/webhook`: Webhook 受信 + CLI 実行
- GET `/health`: ヘルスチェック

#### Phase 2 (将来): Hono 移行

- `node:http` から Hono への移行
- ミドルウェア追加（ロギング、レート制限）
- 複数リポジトリ対応

#### 分離の根拠

shiori 本体に daemon を組み込まない理由:

1. **ADR 018 の原則維持**: shiori は構造化データの生成に集中する
2. **依存関係の分離**: HTTP サーバーのライフサイクルは CLI と異なる
3. **デプロイ独立性**: daemon は常駐プロセス、CLI はコマンド実行
4. **認証情報の責務分離**: Webhook secret は daemon 固有の関心事

### CLI インターフェースによる疎結合

daemon は shiori CLI を `child_process.execFile` で呼び出す。ライブラリとしてインポートせず、CLI の JSON 出力（EP-0075）を消費する。

利点:

- shiori CLI のバージョンアップが daemon に影響しにくい
- テストが容易（CLI をモックコマンドに置換可能）
- shiori の内部 API に依存しない

### 環境変数による設定

| 変数                    | 必須 | デフォルト      | 説明                        |
| ----------------------- | ---- | --------------- | --------------------------- |
| `SHIORI_WEBHOOK_SECRET` | ✓    | -               | GitHub Webhook HMAC secret  |
| `SHIORI_PORT`           | -    | 3000            | HTTP ポート                 |
| `SHIORI_CWD`            | -    | `process.cwd()` | shiori CLI 実行ディレクトリ |
| `SHIORI_PATH`           | -    | `shiori`        | shiori CLI バイナリパス     |
| `SHIORI_TIMEOUT`        | -    | 60 (秒)         | CLI 実行タイムアウト        |
| `GITHUB_TOKEN`          | -    | -               | shiori CLI に渡される       |

## Alternatives Considered

### A. shiori 本体に daemon サブコマンドを追加

`shiori daemon start` のように本体 CLI に組み込む。

- 利点: インストール・設定が一箇所で完結
- 欠点: HTTP サーバーの依存関係が CLI に混入。ADR 018 に反する
- 判断: 不採用

### B. GitHub Actions のみでの実現

GitHub Actions の `issues: closed` イベントで `shiori resolve --closed` を実行する。

- 利点: インフラ不要、設定がシンプル
- 欠点: GitHub Actions のランタイム制約、自ホスト環境では使えない
- 判断: 相互補完的。Actions レシピは別途提供するが、daemon は自律的な常駐プロセスとして異なるニーズに対応

### C. 初期段階から Hono を採用

Phase 1 から Hono を使用してミドルウェアスタックを構築する。

- 利点: 拡張性が初期から高い
- 欠点: 外部依存が増える。Phase 1 の2エンドポイントには過剰
- 判断: 不採用。Phase 2 で Hono 移行が自然な拡張パスとなる

## Consequences

### 追加されるもの

- `pnpm-workspace.yaml`: モノレポ化
- `packages/shiori-daemon/`: 新パッケージ（4 ソースファイル + 3 テストファイル）

### 変更されるもの

- なし（既存コード・依存関係に変更なし）

### 他 ADR への影響

- **ADR 018**: 分離パッケージ方針により、shiori 本体の「データ生成器」原則を維持
- **ADR 025**: daemon は `resolve --closed` コマンドを通じて ref-status プロバイダを間接利用
