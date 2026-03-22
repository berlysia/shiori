# v0.2.0 移行ガイド

v0.1.x から v0.2.0 へのアップグレード手順です。**exit code の値が変更される破壊的変更**が含まれています。

## 破壊的変更: Exit Code の再定義

v0.2.0 では [ADR 027](./decisions/027-exit-code-policy.md) に基づき、exit code が 3 カテゴリに細分化されました。

### 変更内容

| 条件                           | v0.1.x | v0.2.0  | 定数名                 |
| ------------------------------ | ------ | ------- | ---------------------- |
| ガバナンス違反検出             | `1`    | `1`     | `GOVERNANCE_VIOLATION` |
| CLI 引数・オプションの誤り     | `1`    | **`2`** | `USAGE_ERROR`          |
| 環境エラー（ファイル未発見等） | `1`    | **`3`** | `ENVIRONMENT_ERROR`    |

### 影響を受けるケース

**CI ゲート（`shiori check` / `shiori verify`）は影響なし。** これらのコマンドはガバナンス違反検出時に exit `1` を返し、この値は変更されていません。

影響があるのは、**usage / environment カテゴリのコマンドの exit code を厳密にチェックしているスクリプト**です:

```bash
# v0.1.x: scan の引数エラーで exit 1 が返っていた
shiori scan --invalid-option || echo "failed"  # exit 1

# v0.2.0: 同じケースで exit 2 が返る
shiori scan --invalid-option || echo "failed"  # exit 2
```

### 移行手順

#### 1. CI ワークフローの確認（大半は変更不要）

```yaml
# このパターンは変更不要（exit 1 のまま）
- name: Governance check
  run: shiori check
```

`shiori check` / `shiori verify` の exit code `1` は変わっていないため、ほとんどの CI 設定はそのまま動作します。

#### 2. exit code の値を直接参照しているスクリプトの修正

exit code の数値を直接比較しているスクリプトがある場合は更新が必要です:

```bash
# v0.1.x: すべて exit 1 だったため区別不要だった
shiori scan --path ./src
if [ $? -eq 1 ]; then
  echo "something went wrong"
fi

# v0.2.0: カテゴリ別に分岐可能
shiori scan --path ./src
case $? in
  0) echo "success" ;;
  1) echo "governance violation" ;;
  2) echo "usage error (bad arguments)" ;;
  3) echo "environment error (missing files)" ;;
esac
```

#### 3. passthrough コマンドの exit code 修正

`watch`、`journal`、`guide` コマンドは v0.1.x で非ガバナンス条件でも exit `1` を返すことがありましたが、v0.2.0 では適切な exit code を返すようになりました。これらのコマンドの exit code に依存する処理がある場合は確認してください。

## その他の変更

### セキュリティ修正

CI ワークフローテンプレート（`shiori-pr-comment.yml`、`shiori-pr-description.yml`）で `execSync` を `execFileSync`（配列引数）に置き換え、コマンドインジェクションリスクを排除しました。`shiori init --ci` で生成したワークフローを使用している場合は、テンプレートの再生成を推奨します:

```bash
shiori init --ci delta-pr-comment  # 安全なテンプレートで上書き
```

### doctor の新チェック

`shiori doctor` に exit code ポリシー整合性の自己検証チェックが追加されました。通常の `shiori doctor` 実行で自動的に検証されます:

```bash
shiori doctor
```

## バージョン確認

```bash
npx @berlysia/shiori --version
# 0.2.0
```

## 関連ドキュメント

- [ADR 027: CLI Exit Code Policy Matrix](./decisions/027-exit-code-policy.md)
- [CHANGELOG](../CHANGELOG.md)
