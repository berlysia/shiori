# Getting Started — 5 Minutes to Governed Code

shiori を使って、既存コードベースの lint disable コメントを 5 分で可視化・追跡可能にするハンズオンガイドです。

> **README の [Quick Start](../packages/shiori-cli/README.md#quick-start) との違い:** Quick Start は最短 3 コマンドのリファレンスです。このガイドは各ステップで「何が起きているか」を体験しながら理解する実践ウォークスルーです。

## 前提条件

- **Node.js >= 18.0.0**（推奨: 22.x）
- **npm / pnpm / yarn** いずれか
- **lint disable コメントを含むプロジェクト**（`eslint-disable`, `stylelint-disable` 等）

> lint disable が一つもないプロジェクトでも動作しますが、このガイドの効果を実感するには数個以上の disable コメントがあるプロジェクトがおすすめです。

## Step 0: まず試してみる（セットアップ不要）

自分のプロジェクトをスキャンする前に、デモで shiori の動作を確認できます:

```bash
npx @berlysia/shiori scan --demo
```

**何が起きるか:** 組み込みのサンプルファイル（ESLint / stylelint / スタンドアロンの 3 種類のアノテーション）を使って scan → verify → health のパイプライン全体を実行し、結果を表示します。インストールもプロジェクトの変更も不要です。

<details>
<summary>出力例</summary>

```
━━━ shiori scan --demo ━━━━━━━━━━━━━━━━━━━━━

shiori はソースコード中の lint disable コメントや設計判断を
構造化アノテーションとして追跡し、技術的負債を可視化します。

このデモでは 3 つのサンプルファイルを使って動作を体験できます:

── Scan Results ────────────────────────────
ファイル数: 3   アノテーション数: 3

  DEMO-001   src/api-client.ts:2   no-console   expires=2025-12-31
  DEMO-002   src/theme.css:2   color-named
  DEMO-003   src/config.ts:2

── Verify Issues ───────────────────────────
  ✗ [expired] DEMO-001 — Registry entry expired (2025-12-31)

── Health ──────────────────────────────────
🟡 スコア: 67/100 (warning)

── 次のステップ ────────────────────────────
  $ shiori init            # プロジェクトにレジストリを作成
  $ shiori scan            # 実際のソースコードをスキャン
  $ shiori health          # ガバナンス健全性を確認
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

</details>

デモで表示される 3 つのアノテーションは、shiori が検出する主要なパターンを網羅しています:

| デモ ref   | パターン                          | 意味                                 |
| ---------- | --------------------------------- | ------------------------------------ |
| `DEMO-001` | lint disable + `shiori:` マーカー | ルール違反の追跡（期限切れの例付き） |
| `DEMO-002` | lint disable + `shiori:` マーカー | 互換性理由の抑制（期限なし）         |
| `DEMO-003` | スタンドアロン `shiori:` コメント | 設計判断のドキュメント化             |

> **JSON 出力も対応:** `npx @berlysia/shiori scan --demo | cat` でパイプすると JSON が出力されます。`--output report.json` でファイルに保存することもできます。

デモの動作を確認したら、Step 1 に進んで自分のプロジェクトをセットアップしましょう。

## Step 1: インストールと初期化

```bash
pnpm add -D @berlysia/shiori    # npm install -D / yarn add -D でも可
shiori init
```

**何が起きるか:** `.config/shiori/` ディレクトリが作成され、空のレジストリファイル（`registry.json`）と設定ファイルが生成されます。

<details>
<summary>出力例</summary>

```
✔ Created .config/shiori/config.yaml
✔ Created .config/shiori/registry.json
✔ Updated .gitignore
```

</details>

> **CI も一緒にセットアップしたい場合:** `shiori init --ci basic` で GitHub Actions ワークフローも同時に生成されます。

## Step 2: ソースコードをスキャン

```bash
shiori scan
```

**何が起きるか:** プロジェクト内の全ソースファイルを走査し、lint disable コメントと `shiori:` アノテーションを検出します。結果は `.config/shiori/scan-result.json` に保存されます。

<details>
<summary>出力例</summary>

```
Scanned 142 files
Found 8 annotations, 15 candidates
Saved to .config/shiori/scan-result.json
```

</details>

ここで見つかるのは 2 種類です:

| 種類           | 説明                                               | 例                                                          |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| **annotation** | `shiori:` マーカー付きの既存アノテーション         | `// eslint-disable-next-line no-console -- shiori: SUP-123` |
| **candidate**  | `shiori:` のない lint disable コメント（追跡候補） | `// eslint-disable-next-line no-console`                    |

## Step 3: 候補をまとめて取り込み

```bash
shiori adopt --apply
```

**何が起きるか:** Step 2 で検出された candidate（未追跡の lint disable）に `shiori:` マーカーを挿入し、レジストリにエントリを追加します。ソースファイルとレジストリの両方が更新されます。

<details>
<summary>出力例</summary>

```
Adopted 15 candidates:
  ADOPT-001 → src/utils/legacy.ts:12 (no-explicit-any)
  ADOPT-002 → src/api/client.ts:45 (no-console)
  ...
Updated .config/shiori/registry.json (15 new entries)
```

</details>

> **プレビューしてから適用したい場合:** `--apply` を外して `shiori adopt` を実行すると、変更のプレビュー（dry-run）のみ表示されます。
>
> **対話的に選んで取り込みたい場合:** `shiori adopt --wizard` で、候補をグループ単位で選択できます。

### レジストリを確認する

この時点で `.config/shiori/registry.json` を開くと、各 ref のスタブエントリが生成されています:

```json
{
  "ADOPT-001": {
    "reason": "adopted by shiori adopt",
    "target": "src/utils/legacy.ts",
    "kind": "adoption"
  }
}
```

`reason`、`owner`、`expires` をプロジェクトに合わせて埋めていくことで、ガバナンスの価値が高まります。

## Step 4: 整合性を検証

```bash
shiori verify
```

**何が起きるか:** スキャン結果とレジストリを突合し、不整合を検出します。Step 3 の直後であれば問題なし（0 issues）のはずです。

<details>
<summary>出力例</summary>

```json
{
  "summary": {
    "annotations": 15,
    "candidates": 0,
    "issues": 0
  }
}
```

</details>

検出される不整合の種類:

| Issue type            | 意味                               |
| --------------------- | ---------------------------------- |
| `missing-in-registry` | ソースにあるがレジストリにない ref |
| `unused-in-source`    | レジストリにあるがソースにない ref |
| `expired`             | `expires` 期限切れ                 |
| `expiring-soon`       | 期限間近（デフォルト: 14 日以内）  |
| `syntax-error`        | `shiori:` マーカーの構文エラー     |

> **CI で使うなら `shiori check`:** `scan` + `verify` を一発で実行し、`--fail-on` で CI 失敗条件を指定できます:
>
> ```bash
> shiori check --fail-on missing-in-registry,expired
> ```

## Step 5: ヘルスチェック

```bash
shiori health
```

**何が起きるか:** レジストリ全体の健全性スコア（0-100）を算出し、サマリーを表示します。期限切れ・未追跡・構文エラーが多いほどスコアが下がります。

<details>
<summary>出力例</summary>

```
Governance Health: 85/100 (healthy)

  Entries: 15 tracked, 0 candidates
  Issues:  0 expired, 0 missing
  Score breakdown:
    - Base:        100
    - Expired:     -0
    - Missing:     -0
    - Candidates:  -15
```

</details>

> **JSON 出力でダッシュボードに連携:** `shiori health -f json` で構造化データとして取得できます。

## 完了 🎉

ここまでで、プロジェクトの lint disable コメントは：

1. **可視化** — `scan` で全数を把握
2. **追跡** — `adopt` で ref を付与してレジストリに登録
3. **検証** — `verify` / `check` で不整合を検出
4. **計測** — `health` でスコア化

## Next Steps

### CI 統合

```bash
# GitHub Actions ワークフローを生成
shiori init --ci basic

# PR に差分コメントを付ける
shiori init --ci delta-pr-comment
```

詳細: [CI Integration](../packages/shiori-cli/README.md#ci-integration)

### ガバナンスの深化

| やりたいこと                     | レシピ                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| 週次スナップショットで時系列追跡 | [Governance Observatory](./recipes/governance-observatory.md)    |
| LLM で改善提案を自動生成         | [Governance Coach](./recipes/governance-coach.md)                |
| PR に差分サマリーを表示          | [Delta PR Comment](./recipes/github-actions-delta-pr-comment.md) |
| CI でチェックゲートを設定        | [Checks Gate](./recipes/github-checks-gate.md)                   |
| Slack に通知を送信               | [Slack Notification](./recipes/slack-notification.md)            |

### レジストリの充実

adopt で生成されたスタブエントリを充実させましょう:

```json
{
  "ADOPT-001": {
    "reason": "Legacy API returns untyped response; migration planned for Q3",
    "target": "src/utils/legacy.ts",
    "expires": "2026-09-30",
    "ticket": "JIRA-4567",
    "owner": "team-platform",
    "kind": "compat"
  }
}
```

`reason`（なぜ抑制が必要か）と `expires`（いつ見直すか）を設定することで、チームの技術的負債の可視性が大幅に向上します。

---

## 関連ドキュメント

- [README — Quick Start](../packages/shiori-cli/README.md#quick-start) — 最短 3 コマンドのリファレンス
- [Configuration](./configuration.md) — 設定ファイルの詳細
- [API Reference](./api.md) — プログラマティック API
- [All Recipes](./recipes/) — 統合レシピ集（28 種）
