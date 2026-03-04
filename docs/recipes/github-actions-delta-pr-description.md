# GitHub Actions: Delta PR Description

PRのアノテーション増減と **triage（優先度付き技術負債レポート）** を **PR Description（本文）** に自動埋め込みするレシピ。

## 概要

PR コメントではなく PR Description 自体にガバナンスサマリーを埋め込むことで、レビューア が PR を開いた瞬間にアノテーション変更と技術負債の状況を把握できます。

このレシピは以下を実現します：

1. **ベーススキャン**（`main` ブランチのアノテーション一覧）を artifact として保存
2. **PRブランチでスキャン**し、ベースとの差分を `shiori delta --format markdown` で計算
3. **triage レポート**を `shiori triage --format markdown` で生成し、優先度付きアクションリストを提供
4. PR Description 内の `<!-- shiori-delta-start/end -->` および `<!-- shiori-triage-start/end -->` セクションを自動更新
5. アノテーション純増数が閾値を超えた場合はCIを失敗させる（`--max-increase`）

> **PR Comment との使い分け**: PR Description への埋め込みは「常にPR本文で確認したい」チーム向け。コメント通知を活用したい場合は [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) を使ってください。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み（`pnpm add -D shiori`）
- GitHub Actions で `pull_request` イベントをトリガーに使用

## PR テンプレートの準備

PR Description にマーカーコメントを含むテンプレートを用意します。
shiori が差分レポートを埋め込む区間を `<!-- shiori-delta-start -->` と `<!-- shiori-delta-end -->` で、triage レポートを `<!-- shiori-triage-start -->` と `<!-- shiori-triage-end -->` で囲みます。

```markdown
<!-- .github/pull_request_template.md -->

## Summary

<!-- PRの概要を記述 -->

## Test Plan

- [ ] テストが通ること

## Governance Summary

<!-- shiori-delta-start -->

_Waiting for CI..._

<!-- shiori-delta-end -->

## Triage Report

<!-- shiori-triage-start -->

_Waiting for CI..._

<!-- shiori-triage-end -->
```

> **Note:** マーカーコメントがない場合、ワークフローは PR Description の末尾にセクションを追加します。

## ワークフロー構成

---

### 1. ベーススキャン保存ワークフロー

`main` ブランチへのプッシュ時にスキャン結果を artifact として保存します。
（[Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) と共通。既に設定済みならスキップ可能。）

```yaml
# .github/workflows/shiori-base.yml
name: shiori baseline

on:
  push:
    branches:
      - main

jobs:
  scan-base:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Scan annotations (baseline)
        run: pnpm shiori scan --output .tmp/shiori-base-scan.json

      - name: Upload baseline scan artifact
        uses: actions/upload-artifact@v4
        with:
          name: shiori-base-scan
          path: .tmp/shiori-base-scan.json
          retention-days: 90
          overwrite: true
```

---

### 2. PR Description 更新ワークフロー

PRブランチでスキャンを実行し、ベースと比較して PR Description を更新します。

```yaml
# .github/workflows/shiori-pr-description.yml
name: shiori PR description

on:
  pull_request:
    branches:
      - main

jobs:
  delta-description:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # ベースラインartifactを取得
      - name: Download baseline scan artifact
        uses: actions/download-artifact@v4
        with:
          name: shiori-base-scan
          path: .tmp/
        continue-on-error: true

      # PRブランチのアノテーションをスキャン
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # 差分を計算してMarkdownレポートを生成
      - name: Compute delta
        id: delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format markdown \
            --base-fallback-empty \
            --max-increase 0 \
            --output .tmp/shiori-delta.md
        continue-on-error: true

      # Triage レポートを生成
      - name: Generate triage report
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      # PR Description のマーカー区間を差分・triageレポートで置換
      - name: Update PR description
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');

            // Read delta report
            let deltaContent;
            try {
              deltaContent = fs.readFileSync('.tmp/shiori-delta.md', 'utf-8').trim();
            } catch {
              deltaContent = '_No delta report generated._';
            }

            // Read triage report
            let triageContent;
            try {
              triageContent = fs.readFileSync('.tmp/shiori-triage.md', 'utf-8').trim();
            } catch {
              triageContent = '_No triage report generated._';
            }

            // Get current PR description
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });
            let body = pr.body || '';

            // Helper: replace content between markers or append section
            function replaceSection(body, startMarker, endMarker, content, heading) {
              const startIdx = body.indexOf(startMarker);
              const endIdx = body.indexOf(endMarker);
              if (startIdx !== -1 && endIdx !== -1) {
                return (
                  body.substring(0, startIdx + startMarker.length) +
                  '\n' + content + '\n' +
                  body.substring(endIdx)
                );
              } else {
                return (
                  body +
                  '\n\n## ' + heading + '\n\n' +
                  startMarker + '\n' +
                  content + '\n' +
                  endMarker
                );
              }
            }

            body = replaceSection(
              body,
              '<!-- shiori-delta-start -->',
              '<!-- shiori-delta-end -->',
              deltaContent,
              'Governance Summary',
            );
            body = replaceSection(
              body,
              '<!-- shiori-triage-start -->',
              '<!-- shiori-triage-end -->',
              triageContent,
              'Triage Report',
            );

            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              body: body,
            });

      # --max-increase を超えた場合にCIを失敗させる
      - name: Fail if annotation count increased
        if: steps.delta.outcome == 'failure'
        run: |
          echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
          exit 1
```

---

## PR Description の出力サンプル

CI 実行後、PR Description の Governance Summary セクションが以下のように更新されます：

```markdown
## Governance Summary

<!-- shiori-delta-start -->
<!-- shiori-delta -->

# Annotation Delta Report

## Summary

| Metric    | Count  |
| --------- | ------ |
| Added     | 2      |
| Removed   | 0      |
| Unchanged | 13     |
| **Net**   | **+2** |

## Added

| Ref      | File                    | Line |
| -------- | ----------------------- | ---- |
| SUP-9999 | src/utils/format.ts     | 42   |
| SUP-8888 | src/components/Form.tsx | 17   |

<details><summary>13 unchanged annotation(s)</summary>

| Ref      | File              | Line |
| -------- | ----------------- | ---- |
| SUP-1234 | src/api/client.ts | 8    |

...

</details>
<!-- shiori-delta-end -->

## Triage Report

<!-- shiori-triage-start -->

# Shiori Triage Report

**Generated:** 2025-01-15T10:00:00.000Z

## Summary

| Priority | Count |
| -------- | ----- |
| critical | 1     |
| high     | 1     |
| medium   | 0     |
| low      | 0     |

## Action Items

### 🔴 Critical

| Ref      | Issues  | Owner      | Action                                          |
| -------- | ------- | ---------- | ----------------------------------------------- |
| SUP-1234 | expired | team-infra | shiori resolve --ref SUP-1234 or extend expires |

### 🟡 High

| Ref      | Issues              | Owner | Action        |
| -------- | ------------------- | ----- | ------------- |
| SUP-9999 | missing-in-registry | -     | shiori update |

<!-- shiori-triage-end -->
```

---

## カスタマイズ

### アノテーション増加の閾値を変更する

```yaml
# 最大3件まで増加を許容する例
- name: Compute delta
  run: |
    pnpm shiori delta \
      --base .tmp/shiori-base-scan.json \
      --head .tmp/shiori-head-scan.json \
      --max-increase 3 \
      ...
```

### ベリファイ（レジストリ照合）も合わせて実行する

```yaml
- name: Verify annotations
  run: pnpm shiori verify
  continue-on-error: true
```

### Triage レポートをフィルタリングする

```yaml
# 特定のオーナーの技術負債のみ表示
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --owner team-platform \
      --output .tmp/shiori-triage.md

# 期限切れのみ表示
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --expired-only \
      --output .tmp/shiori-triage.md
```

### Triage セクションを無効にする

triage セクションが不要な場合は、ワークフローから triage ステップを削除し、PR テンプレートから `<!-- shiori-triage-start/end -->` マーカーを除去してください。delta セクションは独立して動作します。

### PR Comment と PR Description の両方を使う

両レシピを組み合わせることも可能です。PR Description にはサマリーを埋め込み、PR Comment には詳細を投稿するなど、チームの好みに合わせて使い分けてください。

---

## 完全なワークフロー（単一ファイル版）

ベーススキャンとPR Description 更新を1ファイルにまとめたシンプル構成：

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # main ブランチへのプッシュ時にベースラインを保存
  save-baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm shiori scan --output .tmp/shiori-base-scan.json
      - uses: actions/upload-artifact@v4
        with:
          name: shiori-base-scan
          path: .tmp/shiori-base-scan.json
          overwrite: true

  # PR時にデルタ・triageを計算してPR Description を更新
  pr-description:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

      - uses: actions/download-artifact@v4
        with:
          name: shiori-base-scan
          path: .tmp/
        continue-on-error: true

      - name: Scan (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      - name: Delta
        id: delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format markdown \
            --base-fallback-empty \
            --max-increase 0 \
            --output .tmp/shiori-delta.md
        continue-on-error: true

      - name: Triage
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      - name: Update PR description
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let deltaContent;
            try {
              deltaContent = fs.readFileSync('.tmp/shiori-delta.md', 'utf-8').trim();
            } catch {
              deltaContent = '_No delta report generated._';
            }
            let triageContent;
            try {
              triageContent = fs.readFileSync('.tmp/shiori-triage.md', 'utf-8').trim();
            } catch {
              triageContent = '_No triage report generated._';
            }
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });
            let body = pr.body || '';
            function replaceSection(body, startMarker, endMarker, content, heading) {
              const startIdx = body.indexOf(startMarker);
              const endIdx = body.indexOf(endMarker);
              if (startIdx !== -1 && endIdx !== -1) {
                return (
                  body.substring(0, startIdx + startMarker.length) +
                  '\n' + content + '\n' +
                  body.substring(endIdx)
                );
              } else {
                return (
                  body +
                  '\n\n## ' + heading + '\n\n' +
                  startMarker + '\n' +
                  content + '\n' +
                  endMarker
                );
              }
            }
            body = replaceSection(
              body,
              '<!-- shiori-delta-start -->',
              '<!-- shiori-delta-end -->',
              deltaContent,
              'Governance Summary',
            );
            body = replaceSection(
              body,
              '<!-- shiori-triage-start -->',
              '<!-- shiori-triage-end -->',
              triageContent,
              'Triage Report',
            );
            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              body: body,
            });

      - name: Fail if increased
        if: steps.delta.outcome == 'failure'
        run: exit 1
```

---

## トラブルシューティング

### ベースラインが見つからない（初回PRの場合）

`actions/download-artifact` が失敗しても `continue-on-error: true` により処理は継続します。
`shiori delta --base-fallback-empty` フラグがベースファイル不在を空のスキャン結果として扱うため、
初回PRでは全アノテーションが「Added」として表示されます。

### PR Description が更新されない

`permissions.pull-requests: write` が設定されているか確認してください。
Fork PR の場合、`pull_request_target` イベントの使用が必要な場合があります（セキュリティの考慮が必要）。

### マーカーが手動で削除された

マーカーコメント（`<!-- shiori-delta-start/end -->` や `<!-- shiori-triage-start/end -->`）が PR Description から削除された場合、ワークフローは末尾に新しいセクションを追加します。

### `--max-increase` で意図せずCIが失敗する

`continue-on-error: true` を delta ステップに付けているため、PR Description 更新は成功します。
CI失敗は最終ステップで明示的に `exit 1` することで制御しています。

---

## 関連

- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) — PR コメントとして投稿する方式
- [Governance Badge レシピ](./governance-badge.md) — ガバナンススコアバッジ
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
