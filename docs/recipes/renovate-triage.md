# Renovate/Dependabot PR への shiori triage 自動連携

依存更新 PR に `shiori triage` を自動実行し、ライブラリ更新で不要になった可能性のあるアノテーションを PR コメントで通知するレシピ。

## 概要

依存ライブラリの更新により、以前は必要だった lint disable コメント（`eslint-disable` 等）が不要になるケースがあります。
たとえば、ライブラリのバグ回避で抑制していた警告が、バグ修正版への更新で解消される場合です。

このレシピは以下を実現します：

1. **Renovate/Dependabot PR を自動検出**（ブランチ名またはラベルで判定）
2. **`shiori delta`** でアノテーションの増減を計算
3. **`shiori triage --format markdown`** で優先度付きアクションリストを生成
4. 結果を **PR コメント** として投稿し、レビュー時にアノテーション見直しを促す

> **新規コードは不要です。** 既存の `shiori delta` と `shiori triage` コマンドの組み合わせのみで実現します。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み（`pnpm add -D shiori`）
- [ベーススキャン保存ワークフロー](./github-actions-delta-pr-comment.md) が設定済み
- Renovate または Dependabot が設定済み

## ワークフロー

```yaml
# .github/workflows/shiori-renovate-triage.yml
name: shiori renovate triage

on:
  pull_request:
    branches:
      - main
    # Renovate/Dependabot が使用する典型的なパス
    paths:
      - 'package.json'
      - 'pnpm-lock.yaml'
      - 'package-lock.json'
      - 'yarn.lock'

jobs:
  triage-comment:
    # Renovate または Dependabot の PR のみ実行
    if: |
      startsWith(github.head_ref, 'renovate/') ||
      startsWith(github.head_ref, 'dependabot/') ||
      contains(github.event.pull_request.labels.*.name, 'dependencies')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
        with:
          version: latest

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # ベースラインartifactを取得（クロスワークフロー）
      - name: Download baseline scan artifact
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');

            const workflows = await github.rest.actions.listRepoWorkflows({
              owner: context.repo.owner,
              repo: context.repo.repo,
            });
            const baselineWorkflow = workflows.data.workflows.find(
              w => w.name === 'shiori baseline'
            );
            if (!baselineWorkflow) {
              console.log('No baseline workflow found, skipping');
              return;
            }

            const runs = await github.rest.actions.listWorkflowRuns({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: baselineWorkflow.id,
              branch: 'main',
              status: 'success',
              per_page: 1,
            });
            if (runs.data.workflow_runs.length === 0) {
              console.log('No successful baseline runs found, skipping');
              return;
            }

            const runId = runs.data.workflow_runs[0].id;

            const artifacts = await github.rest.actions.listWorkflowRunArtifacts({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runId,
            });
            const artifact = artifacts.data.artifacts.find(
              a => a.name === 'shiori-base-scan'
            );
            if (!artifact) {
              console.log('No baseline scan artifact found, skipping');
              return;
            }

            const download = await github.rest.actions.downloadArtifact({
              owner: context.repo.owner,
              repo: context.repo.repo,
              artifact_id: artifact.id,
              archive_format: 'zip',
            });

            fs.mkdirSync('.tmp', { recursive: true });
            const zipPath = '.tmp/shiori-base-scan.zip';
            fs.writeFileSync(zipPath, Buffer.from(download.data));

            const { execSync } = require('child_process');
            execSync(`unzip -o ${zipPath} -d .tmp/`);
            console.log('Baseline scan artifact downloaded successfully');
        continue-on-error: true

      # PRブランチ（依存更新後）のアノテーションをスキャン
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # 差分を計算
      - name: Compute delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format markdown \
            --base-fallback-empty \
            --output .tmp/shiori-delta.md
        continue-on-error: true

      # triage レポートを生成（期限切れ・解決可能なアノテーションを検出）
      - name: Generate triage report
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      # delta と triage を結合してPRコメント用のレポートを作成
      - name: Compose PR comment
        run: |
          cat > .tmp/shiori-renovate-comment.md << 'HEADER'
          <!-- shiori-renovate-triage -->

          ## 📦 shiori: 依存更新に伴うアノテーション確認

          この PR は依存ライブラリの更新を含んでいます。
          ライブラリ更新により不要になった lint disable コメントがないか確認してください。

          HEADER

          # delta レポートを追加
          if [ -f .tmp/shiori-delta.md ]; then
            echo "### Annotation Delta" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            cat .tmp/shiori-delta.md >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
          fi

          # triage レポートを追加
          if [ -f .tmp/shiori-triage.md ]; then
            echo "---" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            echo "### Triage Report" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            cat .tmp/shiori-triage.md >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
          fi

          # フッターを追加
          cat >> .tmp/shiori-renovate-comment.md << 'FOOTER'

          ---

          <details>
          <summary>💡 このコメントについて</summary>

          このコメントは `shiori triage` によって依存更新 PR に自動投稿されています。
          ライブラリ更新で解消された問題に対応する lint disable コメントを発見し、
          技術負債の解消機会を通知します。

          **推奨アクション:**

          1. Triage Report の Critical / High 項目を確認
          2. 更新されたライブラリに関連するアノテーションがあれば `shiori resolve` で解消
          3. 不明な場合は `shiori why <ref>` で抑制理由を確認

          </details>
          FOOTER

      # PRコメントに投稿（既存コメントは上書き）
      - name: Post triage as PR comment
        uses: peter-evans/create-or-update-comment@v5
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-renovate-comment.md
          comment-author: 'github-actions[bot]'
          body-includes: '<!-- shiori-renovate-triage -->'
```

---

## PRコメントの出力サンプル

CI 実行後、依存更新 PR に以下のようなコメントが投稿されます：

```markdown
<!-- shiori-renovate-triage -->

## 📦 shiori: 依存更新に伴うアノテーション確認

この PR は依存ライブラリの更新を含んでいます。
ライブラリ更新により不要になった lint disable コメントがないか確認してください。

### Annotation Delta

| Metric    | Count  |
| --------- | ------ |
| Added     | 0      |
| Removed   | 1      |
| Unchanged | 14     |
| **Net**   | **-1** |

### Removed

| Ref      | File              | Line |
| -------- | ----------------- | ---- |
| SUP-5678 | src/api/client.ts | 23   |

---

### Triage Report

| Priority | Count |
| -------- | ----- |
| critical | 1     |
| high     | 0     |
| medium   | 2     |
| low      | 0     |

### 🔴 Critical

| Ref      | Issues  | Owner      | Action                                          |
| -------- | ------- | ---------- | ----------------------------------------------- |
| SUP-1234 | expired | team-infra | shiori resolve --ref SUP-1234 or extend expires |

---

<details>
<summary>💡 このコメントについて</summary>

このコメントは `shiori triage` によって依存更新 PR に自動投稿されています。
...

</details>
```

---

## カスタマイズ

### 対象ブランチパターンを変更する

Renovate/Dependabot 以外のボットやカスタムブランチ名に対応する場合：

```yaml
if: |
  startsWith(github.head_ref, 'renovate/') ||
  startsWith(github.head_ref, 'dependabot/') ||
  startsWith(github.head_ref, 'deps/') ||
  contains(github.event.pull_request.labels.*.name, 'dependencies')
```

### 期限切れアノテーションのみに絞る

更新に直接関係するアノテーションだけ通知したい場合：

```yaml
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --expired-only \
      --output .tmp/shiori-triage.md
```

### 特定チームのアノテーションに絞る

```yaml
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --owner team-platform \
      --output .tmp/shiori-triage.md
```

### アノテーション増加をCIゲートにする

依存更新でアノテーションが増えた場合にCIを失敗させる場合：

```yaml
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

# ... (コメント投稿ステップ) ...

- name: Fail if annotation count increased
  if: steps.delta.outcome == 'failure'
  run: |
    echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
    exit 1
```

### 既存の Delta PR Comment ワークフローと共存する

既に [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) を導入済みの場合、
このレシピは **依存更新 PR にのみ** triage レポート付きの追加コメントを投稿します。
コメントマーカーが異なる（`<!-- shiori-renovate-triage -->` vs `<!-- shiori-delta -->`）ため、
両方のコメントが独立して投稿・更新されます。

---

## トラブルシューティング

### Renovate PR でワークフローが実行されない

`if` 条件のブランチ名パターンが Renovate の設定と一致しているか確認してください。
Renovate のデフォルトブランチプレフィックスは `renovate/` ですが、カスタム設定で変更されている場合があります。

ラベルベースの判定（`contains(github.event.pull_request.labels.*.name, 'dependencies')`）を
追加することで、ブランチ名に依存しない検出も可能です。

### ベースラインが見つからない

[Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) と同じ仕組みです。
`continue-on-error: true` と `--base-fallback-empty` により、初回は全アノテーションが「Added」として表示されます。

### triage で検出される項目が依存更新と無関係に見える

`shiori triage` はプロジェクト全体のアノテーションを対象にトリアージします。
依存更新に直接関連するアノテーションだけに絞りたい場合は、`--expired-only` フィルタの使用を検討してください。

将来的に `shiori triage --changed-files` のようなオプションが追加された場合、
差分ファイルに限定したトリアージが可能になります。

---

## 関連

- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) — 全PRへのデルタコメント
- [Delta PR Description レシピ](./github-actions-delta-pr-description.md) — PR Description への埋め込み
- [Expires Alert レシピ](./github-actions-expires-alert.md) — 定期的な期限切れ通知
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
