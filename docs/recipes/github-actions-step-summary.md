# GitHub Actions Step Summary

`--format github-summary` を使って CI 実行結果を GitHub Actions の Step Summary にリッチ表示するレシピ。

## 概要

GitHub Actions の `$GITHUB_STEP_SUMMARY` に直接出力することで、ワークフロー実行結果のサマリータブにガバナンス情報を表示します。アーティファクトのダウンロードやコメント投稿が不要な、最もシンプルな CI 可視化パターンです。

## 対応コマンド

| コマンド                                | 出力内容                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `shiori verify --format github-summary` | エラー/警告カウント、Issue タイプ別内訳、collapsible な Issue 詳細テーブル |
| `shiori report --format github-summary` | ヘルススコアカード、メトリクス概要、Insights、ルール別内訳                 |
| `shiori health --format github-summary` | ヘルススコアカード、期限切れ警告、トレンド、処方箋テーブル                 |

## 基本パターン

```yaml
- name: Shiori verify summary
  continue-on-error: true
  run: shiori verify --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

`continue-on-error: true` が必須です。`shiori verify` はガバナンス違反検出時に exit 1 を返しますが、Step Summary への書き込みと後続ステップ（HTML レポート生成、アーティファクトアップロード等）は継続させる必要があります。

## ワークフロー例

```yaml
# .github/workflows/ci.yml (該当ステップのみ抜粋)
steps:
  - uses: actions/checkout@v7
  - uses: pnpm/action-setup@v6
  - uses: actions/setup-node@v7
    with:
      node-version: '22'
      cache: pnpm
  - run: pnpm install --frozen-lockfile
  - run: pnpm build

  # ガバナンスチェック（pass/fail 判定用）
  - name: shiori check
    run: pnpm shiori check

  # Step Summary: verify 結果（エラー詳細付き）
  - name: Verify summary
    continue-on-error: true
    run: pnpm shiori verify --format github-summary >> "$GITHUB_STEP_SUMMARY"

  # Step Summary: health スコアカード
  - name: Health summary
    continue-on-error: true
    run: pnpm shiori health --format github-summary >> "$GITHUB_STEP_SUMMARY"

  # Step Summary: report（ルール内訳付き）
  - name: Report summary
    continue-on-error: true
    run: pnpm shiori report --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

複数コマンドの出力を同一 `$GITHUB_STEP_SUMMARY` に `>>` で追記すると、1 つの Step Summary ページに統合表示されます。

## 表示例

### verify

```markdown
### ❌ Shiori Verify: 1 error(s), 2 warning(s)

| Metric           | Value |
| ---------------- | ----- |
| Scanned records  | 42    |
| Registry entries | 40    |
| Errors           | 1     |
| Warnings         | 2     |

<details><summary>❌ Errors (1)</summary>

| Ref      | Type      | Location        | Message                          |
| -------- | --------- | --------------- | -------------------------------- |
| SUP-1234 | `expired` | `src/foo.ts:42` | Annotation expired on 2025-01-15 |

</details>
```

### health

```markdown
### 🟢 Shiori Health: 85/100 (healthy)

> 42 tracked annotations, 3 issues remaining

| Metric        | Value |
| ------------- | ----- |
| Issues        | 3     |
| Errors        | 1     |
| Warnings      | 2     |
| Expired       | 1     |
| Expiring soon | 1     |

**Trend:** ↑ improving (+5) over 4 snapshot(s)

<details><summary>💊 Prescriptions (1)</summary>

| Urgency     | Impact | Command         |
| ----------- | ------ | --------------- |
| 🔴 critical | +15pt  | `shiori update` |

</details>
```

## 設計上のポイント

- **`continue-on-error: true`**: verify/health が exit 1 を返しても後続ステップを実行させるために必須。CI の pass/fail 判定は別の `shiori check` ステップで行う
- **追記モード (`>>`)**: 複数コマンドの出力を1つの Summary に統合可能
- **collapsible sections**: `<details>` タグで詳細を折りたたみ、Summary が肥大化しない

## 関連

- [Demo CI Step Summary レシピ](./demo-ci-step-summary.md) — セットアップ不要のデモ版 Step Summary
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) — PR コメントに差分情報を投稿
- [Governance Summary レシピ](./github-actions-governance-summary.md) — PR コメントに統合サマリーを投稿
- [HTML Artifacts Dashboard レシピ](./html-artifacts-dashboard.md) — HTML レポートをアーティファクトとして保存
- [Code Scanning レシピ](./code-scanning.md) — SARIF 形式で IDE インライン表示
