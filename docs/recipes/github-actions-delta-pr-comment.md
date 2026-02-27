# GitHub Actions: Delta PR Comment

PRのアノテーション増減をCIで検出し、差分レポートをPRコメントに自動投稿するEnd-to-Endレシピ。

## 概要

このレシピは以下を実現します：

1. **ベーススキャン**（`main` ブランチのアノテーション一覧）を artifact として保存
2. **PRブランチでスキャン**し、ベースとの差分を `shiori delta` で計算
3. 差分レポートを Markdown 形式でPRコメントに投稿（`peter-evans/create-or-update-comment`）
4. アノテーション純増数が閾値を超えた場合はCIを失敗させる（`--max-increase`）

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み（`pnpm add -D shiori`）
- GitHub Actions で `pull_request` イベントをトリガーに使用

## ワークフロー構成

レシピは **2つのワークフローファイル** で構成されます。

---

### 1. ベーススキャン保存ワークフロー

`main` ブランチへのプッシュ時にスキャン結果を artifact として保存します。

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
          # 90日間保持（デフォルト）。チームの運用に合わせて調整。
          retention-days: 90
          overwrite: true
```

---

### 2. PRコメントワークフロー

PRブランチでスキャンを実行し、ベースと比較してPRコメントに差分を投稿します。

```yaml
# .github/workflows/shiori-pr.yml
name: shiori PR delta

on:
  pull_request:
    branches:
      - main

jobs:
  delta-comment:
    runs-on: ubuntu-latest
    # PRコメントの書き込み権限が必要
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

      # ベースラインartifactを取得。存在しない場合（初PRなど）は後続ステップで --base-fallback-empty が補完。
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
      # --base-fallback-empty: ベースファイルが存在しない初回PRでも動作
      # --max-increase 0: アノテーション純増を禁止（チームポリシーに応じて変更）
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
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        # CIゲートのexit codeを保持しつつ、コメント投稿は継続させる
        continue-on-error: true

      # 差分レポートをPRコメントに投稿（既存コメントは上書き）
      - name: Post delta as PR comment
        uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-delta.md
          # 既存のshioriコメントを識別して上書きするためのマーカー
          comment-author: 'github-actions[bot]'
          body-includes: '<\!-- shiori-delta -->'

      # --max-increase を超えた場合にCIを失敗させる
      - name: Fail if annotation count increased
        if: steps.delta.outputs.exit_code \!= '0'
        run: |
          echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
          exit 1
```

---

## PRコメントのMarkdown出力サンプル

`shiori delta --format markdown` は以下のような出力を生成します：

```markdown
<\!-- shiori-delta -->

## shiori Annotation Delta

|              | Count |
| ------------ | ----- |
| ➕ Added     | 2     |
| ➖ Removed   | 0     |
| ∆ Net change | +2    |
| Total (head) | 15    |

### ➕ Added (2)

| Ref        | File                      | Line |
| ---------- | ------------------------- | ---- |
| `SUP-9999` | `src/utils/format.ts`     | 42   |
| `SUP-8888` | `src/components/Form.tsx` | 17   |

<details>
<summary>Unchanged (13)</summary>

| Ref        | File                | Line |
| ---------- | ------------------- | ---- |
| `SUP-1234` | `src/api/client.ts` | 8    |

...

</details>
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

### キャッシュを使って高速化する

```yaml
# pnpm/action-setup の cache: 'pnpm' で node_modules が自動キャッシュされる
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'
```

---

## 完全なワークフロー（単一ファイル版）

ベーススキャンとPRデルタを1ファイルにまとめたシンプル構成：

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

  # PR時にデルタを計算してコメント投稿
  pr-delta:
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
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        continue-on-error: true

      - uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-delta.md
          comment-author: 'github-actions[bot]'
          body-includes: '<\!-- shiori-delta -->'

      - name: Fail if increased
        if: steps.delta.outputs.exit_code \!= '0'
        run: exit 1
```

---

## トラブルシューティング

### ベースラインが見つからない（初回PRの場合）

`actions/download-artifact` が失敗しても `continue-on-error: true` により処理は継続します。
`shiori delta --base-fallback-empty` フラグがベースファイル不在を空のスキャン結果として扱うため、
初回PRでは全アノテーションが「Added」として表示されます。

### PRコメントが毎回新規投稿される

`peter-evans/create-or-update-comment` は `body-includes` の文字列でコメントを検索します。
`<\!-- shiori-delta -->` マーカーが出力に含まれているかを確認してください。

### `--max-increase` で意図せずCIが失敗する

`continue-on-error: true` を delta ステップに付けているため、コメント投稿は成功します。
CI失敗は最終ステップで明示的に `exit 1` することで制御しています。

---

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Alert-to-Ref ブリッジレシピ](./alert-to-ref.md)
