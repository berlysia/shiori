---
status: Proposed
deps:
  - 1
  - 13
---

# ADR 018: 外部サービス連携戦略

## Context

shiori は現在 JSON/YAML 出力までを提供し、外部サービスとの連携はユーザー任せになっている。競合ツールとの比較:

| ツール          | チケット連携         | 通知                | ダッシュボード |
| --------------- | -------------------- | ------------------- | -------------- |
| DebtBomb        | Jira/Linear 自動作成 | Slack/Discord/Teams | -              |
| eslint-seatbelt | -                    | -                   | Datadog 連携   |
| SonarQube       | Jira 連携            | 多数                | 組み込み       |
| **shiori**      | -                    | -                   | -              |

実務のチームでは以下のワークフローが求められる:

1. **期限切れアノテーションの通知**: Slack/Teams に「SUP-1234 が期限切れです」を通知
2. **チケット自動作成**: マイグレーション対象の ref から Jira/Linear チケットを生成
3. **ダッシュボード**: アノテーション数の推移、ルール別分布、チーム別分布の可視化
4. **CI コメント**: PR に「新規 3 件、期限切れ 1 件」のサマリーをコメント

### 設計上の制約

- shiori はコアを軽量 CLI に保つ方針（ADR 001）
- 外部サービスの認証情報管理は shiori の責務外
- サービス固有の API クライアントを本体に組み込むと依存関係が肥大化

## Decision

### プラグインではなく構造化出力 + レシピの提供

shiori 本体に外部サービス連携を組み込まず、以下の戦略を採る:

1. **構造化出力の強化**: マシンリーダブルな出力を充実させる
2. **公式レシピの提供**: 一般的な連携パターンをドキュメント + スクリプト例として提供
3. **GitHub Actions の公式提供**: CI 統合を最も一般的なユースケースとして重点サポート

#### 1. 構造化出力の強化

現在の JSON 出力に加え、以下のフォーマット/オプションを追加:

```bash
# SARIF 出力（GitHub Code Scanning 統合）
shiori check --format sarif > results.sarif

# JSON Lines 出力（ストリーム処理・ログ基盤連携）
shiori check --format jsonl

# サマリー JSON（ダッシュボード用の集約データ）
shiori check --format summary
```

**SARIF（Static Analysis Results Interchange Format）** を優先する理由:

- GitHub Code Scanning が SARIF をネイティブサポート
- PR 上にアノテーション警告として表示される
- VS Code の SARIF Viewer 等のエコシステムが利用可能
- 他の静的解析ツールとの結果統合が可能

**サマリー JSON の構造**:

```json
{
  "timestamp": "2026-02-16T00:00:00Z",
  "totals": {
    "annotations": 42,
    "candidates": 15,
    "expired": 3,
    "missing": 2
  },
  "byRule": { "no-console": 5, "no-any": 8 },
  "byKind": { "suppression": 30, "migration": 12 },
  "byOwner": { "team-a": 20, "team-b": 22 }
}
```

#### 2. 公式レシピ集（`docs/recipes/`）

ドキュメントとスクリプト例を提供:

##### GitHub Actions + Code Scanning

```yaml
# .github/workflows/shiori.yml
- name: shiori check
  run: shiori check --format sarif > shiori.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: shiori.sarif
```

##### Slack 通知

```bash
# scripts/notify-slack.sh
expired=$(shiori check --format summary | jq '.totals.expired')
if [ "$expired" -gt 0 ]; then
  curl -X POST "$SLACK_WEBHOOK" \
    -d "{\"text\": \"shiori: ${expired} annotations expired\"}"
fi
```

##### Datadog メトリクス

```bash
# scripts/report-datadog.sh
shiori check --format summary | jq -r '
  .totals | to_entries[] |
  "shiori.\(.key):\(.value)|g"
' | while read -r metric; do
  echo "$metric" | nc -u -w1 localhost 8125
done
```

##### Jira チケット作成

```bash
# scripts/create-jira-tickets.sh
shiori check --format json | jq '.issues[] | select(.type == "expired")' |
while read -r issue; do
  ref=$(echo "$issue" | jq -r '.ref')
  # Jira API call...
done
```

#### 3. GitHub Actions 公式アクション（将来）

```yaml
- uses: berlysia/shiori-action@v1
  with:
    command: check
    sarif: true
    comment: true # PR にサマリーコメント
```

### 実装の段階

#### Phase 1（v0.1）: 出力フォーマット拡充

- `--format sarif` の実装
- `--format summary` の実装
- `--format jsonl` の実装

#### Phase 2（v0.2）: レシピ集

- `docs/recipes/` にレシピドキュメントを追加
- GitHub Actions ワークフロー例
- Slack/Datadog/Jira のスクリプト例

#### Phase 3（v0.3+）: GitHub Actions アクション

- `berlysia/shiori-action` リポジトリの作成
- SARIF アップロード + PR コメントの自動化

## Alternatives Considered

### A. プラグインシステムの導入

shiori 本体にプラグイン機構を組み込み、`shiori-plugin-slack`、`shiori-plugin-jira` 等を提供する。

- 利点: `shiori check --notify slack` のような統一的な UX
- 欠点: プラグインシステムの設計・実装コストが高い。認証情報管理が複雑化。v0.0.1 の段階では過剰
- 判断: 不採用。構造化出力 + Unix パイプの組み合わせで同等のことが実現でき、ユーザーの技術スタック（Slack vs Teams、Jira vs Linear）に依存しない

### B. 組み込みの Slack/Jira クライアント

DebtBomb のように本体に直接組み込む。

- 利点: 設定ファイル1つで連携完了。UX が良い
- 欠点: 依存関係が増加。サービスの API 変更に追従が必要。対応サービスのリクエストが永続的に発生
- 判断: 不採用。shiori はコアツールとして構造化データの生成に集中すべき。連携は外部スクリプト/Actions に委ねる

### C. webhook ベースの通知機構

shiori 本体に汎用 webhook 送信機能を組み込む。

- 利点: サービス非依存。JSON ペイロードを任意の URL に POST
- 欠点: 認証ヘッダー管理、リトライロジック、エラーハンドリング等の HTTP クライアント機能が必要
- 判断: 不採用だが Phase 3 以降で再検討の余地あり。現時点ではシェルスクリプト + curl で十分

## Consequences

### 追加されるもの

- SARIF フォーマッター（`src/formatters/sarif.ts`）
- サマリー JSON フォーマッター（`src/formatters/summary.ts`）
- JSONL フォーマッター（`src/formatters/jsonl.ts`）
- `--format` オプション（check, verify コマンド）
- `docs/recipes/` ディレクトリ

### 変更されるもの

- `check-cli.ts`, `verify-cli.ts` に `--format` オプションを追加

### 設計原則

- **shiori はデータ生成器**: 構造化データの出力に集中する
- **連携は外部の責務**: シェルスクリプト、CI パイプライン、Actions が連携を担う
- **SARIF を最優先**: GitHub エコシステムとの親和性が最も高い

### 他 ADR への影響

- **ADR 001**: 軽量 CLI の方針を維持。外部サービス依存を本体に持ち込まない
- **ADR 013**: `--format` オプションが CLI エルゴノミクスに追加される
