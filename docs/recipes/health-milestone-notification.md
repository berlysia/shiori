# Health Milestone Notification

health スコアが閾値に到達したときにポジティブフィードバック通知を送信するレシピ。技術的負債の削減が「目に見える成果」として共有されることで、チームのモチベーションを維持します。

## 概要

ガバナンスの改善は、問題が減る＝通知が減る、という形で見えにくくなりがちです。このレシピは逆のアプローチをとります：

- health スコアが目標閾値（デフォルト: 80）に到達したら 🎉 通知を送信
- スコア改善の経過もメッセージに含める
- Slack / GitHub Step Summary の両方に対応

## スクリプト

```bash
#!/usr/bin/env bash
# health-milestone-notification.sh
# health スコアが閾値を超えた場合にポジティブフィードバック通知を送信
# Requires: SLACK_WEBHOOK_URL environment variable (optional)
set -euo pipefail

THRESHOLD="${1:-80}"

# health スコアを取得
RESULT=$(shiori health -f json 2>/dev/null)
SCORE=$(echo "$RESULT" | jq '.data.health.score')
LEVEL=$(echo "$RESULT" | jq -r '.data.health.level')
ISSUES=$(echo "$RESULT" | jq '.data.issues.total')

# 閾値未満なら通知しない
if [ "$SCORE" -lt "$THRESHOLD" ]; then
  echo "Score ${SCORE} is below threshold ${THRESHOLD}. No notification."
  exit 0
fi

echo "🎉 Health score ${SCORE} reached threshold ${THRESHOLD}!"

# Slack 通知（SLACK_WEBHOOK_URL が設定されている場合）
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  TEXT=":tada: *Governance Milestone Reached!*\n"
  TEXT+=":chart_with_upwards_trend: Health Score: *${SCORE}/100* (${LEVEL})\n"
  TEXT+=":dart: Threshold: ${THRESHOLD}\n"
  TEXT+=":page_facing_up: Remaining issues: ${ISSUES}\n"
  TEXT+="Great work keeping technical debt under control! :muscle:"

  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": \"${TEXT}\"}"
  echo "Slack notification sent."
fi
```

## 使い方

```bash
# デフォルト閾値 (80) でチェック
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/health-milestone-notification.sh

# カスタム閾値: 90
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/health-milestone-notification.sh 90
```

## GitHub Actions Integration

```yaml
# .github/workflows/shiori-health-milestone.yml
name: shiori health milestone

on:
  push:
    branches: [main]
    paths:
      - '.config/shiori/**'
  workflow_dispatch:
    inputs:
      threshold:
        description: 'Health score threshold for celebration'
        required: false
        default: '80'

jobs:
  milestone-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Check health milestone
        id: health
        run: |
          THRESHOLD="${{ inputs.threshold || '80' }}"
          RESULT=$(pnpm shiori health -f json 2>/dev/null)
          SCORE=$(echo "$RESULT" | jq '.data.health.score')
          LEVEL=$(echo "$RESULT" | jq -r '.data.health.level')
          ISSUES=$(echo "$RESULT" | jq '.data.issues.total')

          echo "score=$SCORE" >> "$GITHUB_OUTPUT"
          echo "level=$LEVEL" >> "$GITHUB_OUTPUT"
          echo "issues=$ISSUES" >> "$GITHUB_OUTPUT"
          echo "threshold=$THRESHOLD" >> "$GITHUB_OUTPUT"
          echo "reached=$( [ "$SCORE" -ge "$THRESHOLD" ] && echo true || echo false )" >> "$GITHUB_OUTPUT"

      - name: Post milestone to Step Summary
        if: steps.health.outputs.reached == 'true'
        run: |
          cat >> "$GITHUB_STEP_SUMMARY" <<EOF
          ## 🎉 Governance Milestone Reached!

          | Metric | Value |
          |--------|-------|
          | Health Score | **${{ steps.health.outputs.score }}/100** |
          | Level | ${{ steps.health.outputs.level }} |
          | Threshold | ${{ steps.health.outputs.threshold }} |
          | Remaining Issues | ${{ steps.health.outputs.issues }} |

          Great work keeping technical debt under control!
          EOF

      - name: Notify Slack
        if: steps.health.outputs.reached == 'true' && env.SLACK_WEBHOOK_URL != ''
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          SCORE="${{ steps.health.outputs.score }}"
          LEVEL="${{ steps.health.outputs.level }}"
          THRESHOLD="${{ steps.health.outputs.threshold }}"
          ISSUES="${{ steps.health.outputs.issues }}"

          TEXT=":tada: *Governance Milestone Reached!*\n"
          TEXT+=":chart_with_upwards_trend: Health Score: *${SCORE}/100* (${LEVEL})\n"
          TEXT+=":dart: Threshold: ${THRESHOLD}\n"
          TEXT+=":page_facing_up: Remaining issues: ${ISSUES}\n"
          TEXT+="Great work keeping technical debt under control! :muscle:"

          curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"${TEXT}\"}"

      - name: Post current status (below threshold)
        if: steps.health.outputs.reached == 'false'
        run: |
          echo "### Health Status" >> "$GITHUB_STEP_SUMMARY"
          echo "Score: ${{ steps.health.outputs.score }}/100 (threshold: ${{ steps.health.outputs.threshold }})" >> "$GITHUB_STEP_SUMMARY"
          echo "Keep going! 💪" >> "$GITHUB_STEP_SUMMARY"
```

## 段階的な閾値の設定

プロジェクトの成長に合わせて閾値を上げていくことで、継続的な改善の動機づけができます：

| フェーズ | 閾値 | 意味                                   |
| -------- | ---- | -------------------------------------- |
| 導入期   | 50   | 基本的なアノテーション追跡が開始された |
| 定着期   | 70   | 主要な違反が管理下に入った             |
| 成熟期   | 80   | ガバナンスが日常運用に組み込まれた     |
| 最適化期 | 90   | 技術的負債が積極的に削減されている     |

## Autopilot Kit との統合

[Governance Autopilot Kit](./governance-autopilot-kit.md) の cron ワークフローに組み込む場合は、health チェックの後にマイルストーン判定を追加できます：

```yaml
- name: Health check
  id: health
  run: pnpm shiori health -f json -o .tmp/health.json

- name: Milestone notification
  run: |
    SCORE=$(jq '.data.health.score' .tmp/health.json)
    if [ "$SCORE" -ge 80 ]; then
      echo "🎉 Milestone reached!" >> "$GITHUB_STEP_SUMMARY"
    fi
```

## ガバナンス成熟度モデルにおける位置づけ

このレシピは「ポジティブフィードバックループ」を構造化するものです。問題を検出して警告するレシピ群（Expires Alert、Orchestrator）と対をなし、改善の成果を可視化します。

| Level | 対応レシピ                                             | フィードバック            |
| ----- | ------------------------------------------------------ | ------------------------- |
| 2     | [Checks Gate](./github-checks-gate.md)                 | ❌ 問題がある時にブロック |
| 3     | [Governance Badge](./governance-badge.md)              | 📊 常時スコア表示         |
| 4     | [Orchestrator](./scheduled-governance-orchestrator.md) | ⚠️ 問題を自動 Issue 化    |
| 4+    | **このレシピ**                                         | 🎉 改善を祝う             |

## 関連

- [Slack Pulse](./slack-pulse.md) — 定期的なダッシュボード通知
- [Governance Badge](./governance-badge.md) — README にスコアバッジを表示
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — 問題検出の自動化
