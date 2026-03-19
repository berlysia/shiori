# GitHub Code Scanning: IDE インライン shiori diagnostics

shiori の SARIF 出力を GitHub Code Scanning にアップロードし、VS Code / Codespaces でアノテーション違反をインライン表示するレシピ。

## 概要

このレシピは以下を実現します：

1. **CI で `shiori verify --format sarif` を実行**し、SARIF v2.1.0 形式の診断結果を生成
2. **`github/codeql-action/upload-sarif`** で GitHub Code Scanning にアップロード
3. **Security → Code scanning alerts** タブでアラート一覧を表示
4. **VS Code / Codespaces** でソースコード上にインライン diagnostics として表示

新規コード不要 — 既存の SARIF フォーマッター (`src/formatters/sarif.ts`) をそのまま活用します。

## ユーザー体験の変化

| Before                                   | After                                         |
| ---------------------------------------- | --------------------------------------------- |
| CLI で `shiori check` を手動実行して確認 | VS Code 上で問題行にインライン表示            |
| ターミナル出力からファイル・行を探す     | エディタ内のクリックでジャンプ                |
| 問題の一覧は CLI 出力のみ                | Security タブでフィルタ・検索・ステータス管理 |

## ガバナンス成熟度モデル

| Level | 名称       | 仕組み                                  | レシピ                                                   |
| ----- | ---------- | --------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible  | lint disable で違反が隠れている         | —                                                        |
| 1     | Visible    | PR コメントで差分を通知                 | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced   | PR ステータスチェックでマージをブロック | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured   | ガバナンススコアのバッジ表示            | [Governance Badge](./governance-badge.md)                |
| 4     | **Inline** | **エディタ内にインライン diagnostics**  | **このレシピ**                                           |

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み（`pnpm add -D shiori`）
- GitHub リポジトリで Code Scanning が有効（public リポジトリでは無料、private は GitHub Advanced Security ライセンスが必要）

## ワークフロー

### 最小構成

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  code-scanning:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write

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

      - name: Generate SARIF
        run: pnpm shiori verify --format sarif --output .tmp/shiori.sarif

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .tmp/shiori.sarif
          category: shiori
```

### `shiori init --ci` で自動生成

```bash
pnpm shiori init --ci sarif
```

このコマンドで上記のワークフロー YAML が `.github/workflows/shiori.yml` に自動生成されます。`check` ステップも含まれるため、ステータスチェックと Code Scanning が同時に有効になります。

## 必要な permissions

```yaml
permissions:
  contents: read # リポジトリの読み取り
  security-events: write # SARIF アップロード
```

`security-events: write` がないと `upload-sarif` ステップが 403 で失敗します。

## SARIF 出力の内容

shiori の SARIF フォーマッターは以下の issue type をルールとして出力します：

| Rule ID                     | 説明                                             | Level   |
| --------------------------- | ------------------------------------------------ | ------- |
| `missing-in-registry`       | ソースにあるがレジストリに未登録                 | warning |
| `unused-in-source`          | レジストリにあるがソースに不在                   | warning |
| `expired`                   | 期限を過ぎたアノテーション                       | error   |
| `expiring-soon`             | 期限が近いアノテーション                         | warning |
| `syntax-error`              | アノテーション構文エラー                         | error   |
| `ref-format`                | ref フォーマット不正                             | error   |
| `ref-collision`             | 同一 ref が複数レジストリに存在                  | warning |
| `unrouted-ref`              | ルーティングパターンに一致しない ref             | warning |
| `registry-routing-mismatch` | レジストリファイルがルーティングパターンと不一致 | warning |
| `ref-status-closed`         | 外部ステータスで閉じられた参照先                 | warning |

各ルールの `level`（error/warning）は `shiori verify` の severity マッピングに従います。

## VS Code / Codespaces での表示

SARIF がアップロードされると、GitHub の Code Scanning 機能を通じて：

1. **Security タブ**: リポジトリの Security → Code scanning alerts に全アラートが表示されます
2. **PR の Files changed**: PR の差分ビューに該当行のインラインアノテーションが表示されます
3. **Codespaces**: GitHub Codespaces で作業中、エディタ内に直接 diagnostics が表示されます

### VS Code ローカル環境での表示

VS Code のローカル環境で Code Scanning アラートをインライン表示するには、[GitHub Pull Requests 拡張機能](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)（`GitHub.vscode-pull-request-github`）をインストールしてください。PR レビュー時に Code Scanning アラートがエディタ内にインライン表示されます。

## カスタマイズ

### Checks Gate との併用（推奨）

ステータスチェック（ブロック）と Code Scanning（可視化）を組み合わせるのが最も効果的です：

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: latest
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

      # ステータスチェック（ブロック）
      # exit code 1 で GitHub Checks が failed になり、マージをブロックする
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry

      # Code Scanning（可視化）
      # if: always() により check が失敗しても SARIF アップロードは継続する
      - name: Generate SARIF
        if: always()
        run: pnpm shiori verify --format sarif --output .tmp/shiori.sarif

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .tmp/shiori.sarif
          category: shiori
```

> **Note**: `if: always()` により、`shiori check` が exit code 1 で失敗しても後続の SARIF アップロードが実行されます。`continue-on-error` は使わず、check の失敗がそのまま GitHub Checks のステータスに反映されるため、マージがブロックされつつ違反箇所がインラインで可視化されます。

### Alert-to-Ref ブリッジとの併用

Code Scanning アラートから `shiori show` で詳細情報を引くことができます：

```bash
# アラート番号を指定して ref 情報を表示
./docs/recipes/alert-to-ref.sh owner/repo 42
```

詳細は [Alert-to-Ref レシピ](./alert-to-ref.md) を参照してください。

### `category` の活用

`upload-sarif` の `category` パラメータで、他の SARIF ツール（CodeQL 等）と結果を分離できます：

```yaml
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: .tmp/shiori.sarif
    category: shiori # ← Code Scanning UI でフィルタ可能
```

---

## トラブルシューティング

### SARIF アップロードが 403 で失敗する

`permissions.security-events: write` がワークフローに設定されているか確認してください。Organization レベルで GitHub Actions の権限が制限されている場合は、管理者に確認してください。

### アラートが表示されない

- SARIF ファイルが空（issues が 0 件）の場合、アラートは生成されません。`shiori verify -f json` で issues の件数を確認してください
- `upload-sarif` のログで `Uploaded SARIF` メッセージが表示されているか確認してください
- アップロードから反映まで数分かかる場合があります

### Private リポジトリで Code Scanning が使えない

GitHub Code Scanning は private リポジトリでは [GitHub Advanced Security](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) ライセンスが必要です。代替として [Checks Gate レシピ](./github-checks-gate.md) を使えば、Code Scanning なしでも PR ステータスチェックでガバナンスを強制できます。

### VS Code でインライン表示されない

Codespaces ではなくローカル VS Code の場合、[GitHub Pull Requests 拡張機能](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) が必要です。また、GitHub リポジトリに紐づいていない状態（クローン前やフォーク先）では表示されません。

---

## Composite Action で簡単に使う

上記の YAML を数行に削減できる composite action が利用可能です：

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: sarif
    sarif-category: shiori
```

詳細は [Composite Action レシピ](./github-actions-composite-action.md) を参照してください。

---

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Composite Action レシピ](./github-actions-composite-action.md)
- [Alert-to-Ref ブリッジレシピ](./alert-to-ref.md)
- [Checks Gate レシピ](./github-checks-gate.md)
- [Governance Badge レシピ](./governance-badge.md)
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
