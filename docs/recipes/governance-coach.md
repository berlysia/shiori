# Governance Coach: LLM を活用したガバナンス改善提案

`shiori triage --format json` と `shiori weekly-report --format json` の出力を LLM に渡し、自然言語でガバナンス改善アドバイスを生成するレシピ。

## 概要

shiori が蓄積するアノテーション・ヘルスデータを LLM のコンテキストとして活用し、チーム固有のガバナンス状況に応じた改善提案を自動生成します。shiori 本体に LLM 依存を持ち込まず、構造化出力 + 外部 LLM API の組み合わせで実現します（[ADR 018](../decisions/018-external-service-integration.md) 準拠）。

### 特徴

- **ゼロインフラ**: shiori CLI + LLM API キーのみで動作
- **LLM 非依存**: OpenAI, Anthropic, Google, ローカル LLM など任意のプロバイダで利用可能
- **プロンプトテンプレート方式**: shiori の JSON 出力をテンプレートに埋め込み、LLM に渡す

## 前提条件

- shiori がセットアップ済み（`shiori init` 完了、レジストリにエントリあり）
- LLM API キー（例: `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`）
- `jq` と `curl`（スクリプト例で使用）

## プロンプトテンプレート

### テンプレート 1: Triage アドバイザー

triage 結果から優先度付きのアクションプランを生成します。

````markdown
あなたはソフトウェアガバナンスの専門家です。
以下は shiori（アノテーション追跡ツール）の triage レポート JSON です。

```json
{{TRIAGE_JSON}}
```

この triage 結果を分析し、以下の形式でガバナンス改善提案を作成してください:

## 分析

- 現在のガバナンス状況を 2-3 文で要約
- critical/high の Issue がある場合、その根本原因を推測

## 今週のアクションプラン

優先度順に 3 件以内のアクションを提案してください:

1. **[優先度]** アクション内容 — 理由と期待効果
   - 実行コマンド: `shiori ...`

## 構造的な改善提案

繰り返し発生しているパターンがあれば、プロセスやルールの改善を提案してください。
````

### テンプレート 2: 週次レポートコーチ

週次レポートからトレンドを読み取り、チームへのフィードバックを生成します。

````markdown
あなたはソフトウェアチームのガバナンスコーチです。
以下は shiori の週次ガバナンスレポート JSON です。

```json
{{WEEKLY_REPORT_JSON}}
```

このレポートを分析し、チームミーティングで共有できる形式のフィードバックを作成してください:

## 今週のハイライト

- ヘルススコアの変動と要因を 1-2 文で説明
- 良い傾向があれば具体的に称賛

## 注意ポイント

- スコアが下がった原因や、増加しているアノテーションのパターン
- 期限切れ（expired）や期限間近（expiring-soon）への対応状況

## 来週に向けて

- 具体的な改善アクションを 1-2 件提案
- 各アクションに対応する shiori コマンドを添える
````

### テンプレート 3: 健全性診断

health 結果から処方箋を生成します。

````markdown
あなたはコードベースの健全性を診断する専門家です。
以下は shiori の health チェック結果です。

```json
{{HEALTH_JSON}}
```

診断結果を以下の形式で出力してください:

## 診断サマリー

スコア {{SCORE}}/100 に対する所見を 2-3 文で述べてください。

## 処方箋

改善効果の高い順に 3 件以内:

| 優先度 | 処方 | 期待スコア改善 | コマンド |
| ------ | ---- | -------------- | -------- |
| ...    | ...  | ...            | ...      |

## 予後

現在のペースで改善を続けた場合の 1 ヶ月後のスコア予測と根拠。
````

## 使い方

### 基本: シェルスクリプト

```bash
#!/bin/bash
# scripts/governance-coach.sh
# Usage: OPENAI_API_KEY=sk-... ./scripts/governance-coach.sh

set -euo pipefail

# Step 1: shiori の JSON 出力を取得
TRIAGE_JSON=$(npx shiori triage --format json)
WEEKLY_JSON=$(npx shiori weekly-report --preset weekly --format json)

# Step 2: プロンプトを組み立て
PROMPT=$(cat <<PROMPT_EOF
あなたはソフトウェアガバナンスの専門家です。
以下は shiori（アノテーション追跡ツール）の2つのレポートです。

## Triage レポート
\`\`\`json
${TRIAGE_JSON}
\`\`\`

## 週次レポート
\`\`\`json
${WEEKLY_JSON}
\`\`\`

この2つのレポートを総合的に分析し、以下を出力してください:
1. 現状の要約（2-3文）
2. 今週の最優先アクション（1件、shiori コマンド付き）
3. 中期的な改善提案（1件）
PROMPT_EOF
)

# Step 3: LLM API を呼び出し
curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "$(jq -n --arg prompt "$PROMPT" '{
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: $prompt }],
    temperature: 0.3
  }')" | jq -r '.choices[0].message.content'
```

### CI 統合: GitHub Actions

````yaml
# .github/workflows/shiori-coach.yml
name: shiori governance coach

on:
  schedule:
    # 毎週月曜 9:00 JST (0:00 UTC)
    - cron: '0 0 * * 1'
  workflow_dispatch:

jobs:
  coach:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Generate governance data
        run: |
          npx shiori triage --format json > /tmp/triage.json
          npx shiori weekly-report --preset weekly --format json > /tmp/weekly.json

      - name: Generate coaching advice
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          TRIAGE=$(cat /tmp/triage.json)
          WEEKLY=$(cat /tmp/weekly.json)

          ADVICE=$(curl -s https://api.openai.com/v1/chat/completions \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${OPENAI_API_KEY}" \
            -d "$(jq -n \
              --arg triage "$TRIAGE" \
              --arg weekly "$WEEKLY" \
              '{
                model: "gpt-4o-mini",
                messages: [{
                  role: "user",
                  content: ("shiori ガバナンスデータを分析し、改善提案を作成してください。\n\n## Triage\n```json\n" + $triage + "\n```\n\n## Weekly Report\n```json\n" + $weekly + "\n```\n\n出力形式:\n1. 現状要約（2-3文）\n2. 今週の最優先アクション（shiori コマンド付き）\n3. 中期的な改善提案")
                }],
                temperature: 0.3
              }')" | jq -r '.choices[0].message.content')

          echo "## 🧑‍🏫 Governance Coach" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "$ADVICE" >> "$GITHUB_STEP_SUMMARY"

      - name: Post to Slack (optional)
        if: env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          # Step Summary の内容を Slack に転送
          SUMMARY=$(cat "$GITHUB_STEP_SUMMARY")
          curl -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg text "$SUMMARY" '{ text: $text }')"
````

### ローカル LLM（Ollama）

```bash
#!/bin/bash
# LLM API キー不要、Ollama でローカル実行
TRIAGE_JSON=$(npx shiori triage --format json)

curl -s http://localhost:11434/api/generate \
  -d "$(jq -n --arg triage "$TRIAGE_JSON" '{
    model: "llama3.1",
    prompt: ("shiori triage 結果を分析し改善提案を作成:\n" + $triage),
    stream: false
  }')" | jq -r '.response'
```

### Claude Code との統合

Claude Code を使っている場合、shiori の出力を直接プロンプトに渡せます:

```bash
# triage 結果を Claude Code のコンテキストとして活用
npx shiori triage --format json | pbcopy
# → Claude Code に貼り付けて「この triage 結果を分析して改善提案を作成してください」
```

## JSON 出力スキーマの要点

### triage (`shiori triage --format json`)

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "items": [
    {
      "ref": "SUP-1234",
      "priority": "critical",
      "issues": [{ "type": "expired", "ref": "SUP-1234", "message": "..." }],
      "sourceLocations": [
        { "file": "src/foo.ts", "line": 42, "rule": "no-console" }
      ],
      "action": "shiori update SUP-1234 --expires=2026-06-30"
    }
  ],
  "summary": {
    "total": 5,
    "byPriority": { "critical": 1, "high": 2, "medium": 1, "low": 1 }
  }
}
```

### weekly-report (`shiori weekly-report --format json`)

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "period": { "since": "2026-03-17", "until": "2026-03-24" },
  "activity": {
    "totalOperations": 5,
    "successRate": 100,
    "netChange": 2,
    "uniqueRefs": ["SUP-1234", "SUP-5678"]
  },
  "health": { "score": 85, "level": "healthy", "summary": "..." },
  "registryOverview": {
    "totalEntries": 12,
    "totalAnnotations": 15,
    "totalCandidates": 3,
    "totalIssues": 2
  },
  "insights": [{ "category": "warning", "message": "..." }],
  "velocity": { "count": 0 }
}
```

## カスタマイズ

### プロンプトの調整ポイント

- **温度（temperature）**: `0.3` 前後が安定。高くするとクリエイティブな提案が増える
- **出力言語**: プロンプト内で指定（日本語/英語）
- **フォーカス領域**: 「セキュリティに重点を置いて」「期限切れのみ分析して」等で絞り込み
- **出力形式**: Markdown テーブル、箇条書き、Slack blocks 等をプロンプトで指定

### 複数スナップショットでのトレンド分析

Observatory レシピと組み合わせ、過去のスナップショットを含めてトレンド分析を依頼できます:

```bash
# 直近4週分のスナップショットを結合
SNAPSHOTS=$(for f in observatory/data/*.json; do cat "$f"; echo ","; done | sed '$ s/,$//' | jq -s '.')

# トレンド付きプロンプト
curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "$(jq -n --arg data "$SNAPSHOTS" '{
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: ("過去4週間のガバナンススナップショットを時系列分析:\n" + $data) }]
  }')" | jq -r '.choices[0].message.content'
```

## ガバナンス成熟度モデルにおける位置づけ

| Level | 名称        | 仕組み                           | レシピ                                                   |
| ----- | ----------- | -------------------------------- | -------------------------------------------------------- |
| 0     | Invisible   | lint disable で違反が隠れている  | —                                                        |
| 1     | Visible     | PR コメントで差分を通知          | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced    | PR ステータスチェックでブロック  | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured    | トレンド追跡 + ダッシュボード    | [Observatory](./governance-observatory.md)               |
| 4     | **Coached** | **LLM がデータ駆動で改善を提案** | **このレシピ**                                           |

Level 4 は、蓄積されたガバナンスデータを元に LLM が文脈を理解した改善提案を行い、チームの意思決定を支援する状態です。

---

## 関連

- [Governance Observatory](./governance-observatory.md) — 時系列ダッシュボード（スナップショット蓄積）
- [GitHub Actions Step Summary](./github-actions-step-summary.md) — CI 結果の Step Summary 表示
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — 自動 Issue 生成
- [Slack Notification](./slack-notification.md) — Slack 通知レシピ
