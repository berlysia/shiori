# GitHub Actions: Governance Score Badge

リポジトリのガバナンススコアを shields.io バッジとして README に表示するレシピ。

## 概要

このレシピは以下を実現します：

1. **CI でスキャン＆レポート**: `shiori report --format badge` で shields.io endpoint JSON を生成
2. **Gist にアップロード**: `exuanbo/actions-deploy-gist` で JSON を GitHub Gist に保存
3. **README にバッジ埋め込み**: shields.io endpoint URL でリアルタイムバッジを表示

スコアに応じてバッジ色が自動変化します：

| スコア | 色             | レベル   |
| ------ | -------------- | -------- |
| ≥ 80   | 🟢 brightgreen | healthy  |
| 50–79  | 🟡 yellow      | warning  |
| < 50   | 🔴 red         | critical |

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- GitHub Gist を作成済み（endpoint JSON のホスト先）
- Gist への書き込み権限を持つ `GIST_TOKEN` シークレットを設定済み

## セットアップ手順

### 1. Gist を作成する

GitHub で新しい Gist を作成します：

- ファイル名: `shiori-badge.json`
- 内容（初期値）:
  ```json
  {
    "schemaVersion": 1,
    "label": "governance",
    "message": "pending",
    "color": "lightgrey"
  }
  ```
- Gist ID をメモしておく（URL の末尾: `https://gist.github.com/<user>/<gist-id>`）

### 2. Personal Access Token (PAT) を発行する

- GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Repository permissions は不要。Gist のみ `Read and write` 権限を付与
- リポジトリの Secrets に `GIST_TOKEN` として保存

### 3. ワークフローを追加する

```yaml
# .github/workflows/shiori-badge.yml
name: shiori badge

on:
  push:
    branches: [main]
  # 日次更新（オプション）
  schedule:
    - cron: '0 0 * * *'

jobs:
  badge:
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

      - name: Build
        run: pnpm build

      - name: Generate badge JSON
        run: node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json

      - name: Upload to Gist
        uses: exuanbo/actions-deploy-gist@v1
        with:
          token: ${{ secrets.GIST_TOKEN }}
          gist_id: YOUR_GIST_ID # ← 作成した Gist ID に置換
          file_path: .tmp/shiori-badge.json
          file_type: text
```

### 4. README にバッジを埋め込む

```markdown
[![Governance Score](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2F<user>%2F<gist-id>%2Fraw%2Fshiori-badge.json)](https://gist.github.com/<user>/<gist-id>)
```

`<user>` と `<gist-id>` を実際の値に置換してください。

---

## 代替: GitHub Actions Artifacts を使う方法

Gist を使わず、CI artifacts としてバッジ JSON を保存する軽量な方法：

```yaml
- name: Build
  run: pnpm build

- name: Generate badge JSON
  run: node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json

- name: Upload badge artifact
  uses: actions/upload-artifact@v4
  with:
    name: shiori-badge
    path: .tmp/shiori-badge.json
    retention-days: 90
    overwrite: true
```

この方法ではリアルタイムの README バッジ表示はできませんが、CI 履歴でスコア推移を追跡できます。

---

## 出力フォーマット

`shiori report --format badge` は shields.io endpoint JSON を出力します：

```json
{
  "schemaVersion": 1,
  "label": "governance",
  "message": "85/100",
  "color": "brightgreen"
}
```

フィールドの意味：

| フィールド      | 説明                                                  |
| --------------- | ----------------------------------------------------- |
| `schemaVersion` | shields.io endpoint schema version（常に `1`）        |
| `label`         | バッジ左側テキスト（`governance`）                    |
| `message`       | バッジ右側テキスト（`スコア/100` 形式）               |
| `color`         | shields.io カラー名（`brightgreen`, `yellow`, `red`） |

---

## カスタマイズ

### スケジュール実行の頻度を変更する

```yaml
# 毎週月曜 9:00 UTC に更新
schedule:
  - cron: '0 9 * * 1'
```

### verify エラーがある場合に CI を失敗させる

```yaml
- name: Generate badge and verify
  run: |
    node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json
    node dist/src/cli.js verify --fail-on missing-in-registry,expired
```

---

## トラブルシューティング

### バッジが "pending" のまま

Gist が更新されていない可能性があります。ワークフローの実行ログで `Upload to Gist` ステップを確認してください。`GIST_TOKEN` の権限が正しく設定されているか確認してください。

### shields.io でバッジが表示されない

shields.io は Gist の raw URL をキャッシュします（最大 5 分）。初回は数分待ってからリロードしてください。URL エンコードが正しいか確認してください。

### スコアが想定と異なる

`shiori report` を手動で実行してスコアの内訳を確認してください：

```bash
node dist/src/cli.js report --format json | jq '.health'
```

---

## 関連

- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [Alert-to-Ref ブリッジレシピ](./alert-to-ref.md)
