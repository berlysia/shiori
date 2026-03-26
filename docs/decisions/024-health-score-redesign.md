---
status: Accepted
deps:
  - 4
  - 5
  - 6
---

# ADR 024: Health Score Redesign — 「負債量」から「意思決定の追跡率」へ

## Context

### 問題

現在の health スコア (`src/commands/report.ts: calculateScore()`) は「lint disable が少ないほど健全」という暗黙の前提で設計されている。100点から減点する方式で、expired・未登録・未追跡候補がすべて減点要因になる。単一スコア (0-100) にレベル (healthy/warning/critical) を対応させる。

しかし lint disable が**正当かつ恒久的**なケースは普通に存在する:

- linter ルールが対象のユースケースを想定していない
- ルールの意図を理解した上で、設計上あえて逸脱している
- 回避策が存在しない（例: CSS `@supports` 登場前のフォールバック不可能なケース）

これらに `expires` を付けて「いつか解消」と扱うのは概念的に誤りであり、期限がないことを減点するのもおかしい。健全性は「disable が少ないこと」ではなく「disable が意思決定として記録されていること」を測るべきである。

### kind フィールドの未活用

ADR 004 で `kind` フィールドをレジストリ専用に移行した。`RegistryEntry.kind` は `string | undefined` の自由文字列で、`waive`, `design`, `compat`, `risk`, `migrate` 等が例示されている。しかし kind はレポートの集計 (`byKind`) に使われるだけで、スコア計算に一切影響しない。kind に意味論を持たせてスコアリングと連携させる余地がある。

### 現状のスコアリング

```
100点から開始
- Critical: expired, syntax-error → -10pt/件 (max 40)
- Major: missing-in-registry, unused-in-source, ref-collision → -5pt/件 (max 30)
- Minor: ref-format, unrouted-ref, registry-routing-mismatch, expiring-soon → -2pt/件 (max 10)
- 未追跡候補比率 → max -20pt
```

## Decision

### 1. kind に意味論を導入する

kind フィールドに以下の規約的な値を定義する:

| kind          | 意味                           | expires  | reason   |
| ------------- | ------------------------------ | -------- | -------- |
| `temporary`   | 一時的な抑制。いずれ解消予定   | **必須** | 任意     |
| `intentional` | 正当な理由による恒久的 disable | 不要     | **必須** |
| (未指定)      | = `temporary` として扱う       | **必須** | 任意     |

**設計判断**:

- **デフォルトは temporary**: kind 未指定のエントリは temporary 扱い。intentional は明示的に宣言しない限り得られない。「何も考えずに登録」すると temporary になり、expires がなければ Hygiene が下がる
- **intentional には reason 必須**: `kind: intentional` かつ reason が空なら warning を発行する。「なぜ恒久的なのか」の記録を要求することで、雑な逃げを抑制する。reason を書く手間と expires を管理する手間のバランスで、正しい分類に誘導される
- **ADR 004 の旧 kind 値は非推奨**: `waive`, `design`, `compat`, `risk`, `migrate` は v0.0.1 で実運用されていない。temporary/intentional に統一する。意味的な分類が将来必要になった場合は `category` フィールドを新設する

### 2. 二軸スコアリング (Coverage + Hygiene)

単一の health スコアを2つの独立した軸に分離する。

#### Coverage（追跡率）

「全 disable コメントのうち何%が shiori 管理下にあるか」を測る。

```
Coverage = tracked / (tracked + candidates)
```

- **tracked の定義**: `shiori:` マーカーを持つすべてのアノテーション。draft（ref なし、ADR 005）も含む。「shiori: マーカーがある = 誰かが追跡を意図した」と見なす
- kind に関係なく、マーカーがあれば Coverage に寄与する
- missing-in-registry はレジストリ登録がまだだが、マーカーは付いているので Coverage には含まれる（Hygiene で拾う）

#### Hygiene（衛生）

「管理下のもののライフサイクル管理ができているか」を測る。

- **temporary** (kind 未指定含む): expires 必須。期限切れ (expired) は減点、expiring-soon は軽度減点
- **intentional**: reason 必須。reason なしは warning 減点。reason が記入済みなら Hygiene への減点なし
- **共通**: missing-in-registry（マーカーはあるが未登録）、unused-in-source（レジストリにあるがソースにない）、ref-collision は Hygiene を下げる

### 3. 総合スコアと CI 統合

#### CI は軸ごとに閾値設定

```bash
shiori check --coverage-threshold 80 --hygiene-threshold 70
```

二軸を独立に評価する。片方が高くても他方が低ければ fail になる。

#### Convenience 総合スコア

ダッシュボード表示用に `min(coverage, hygiene)` で算出する。これはあくまで参考値であり、CI の判定には使わない。

**min() を選択した理由**: 弱い方の軸に引きずられることで、片方だけを高めて他方を放置する運用を防ぐ。加重平均は Coverage 90 / Hygiene 30 を「60点」と表示してしまい、深刻な Hygiene の問題が隠れる。CI は軸ごと閾値で判定するため、総合スコアは厳しめの min() で問題ない。

### 4. 新しい verify issue type

| issue type                   | level   | 条件                                            |
| ---------------------------- | ------- | ----------------------------------------------- |
| `intentional-without-reason` | warning | kind=intentional かつ reason が空               |
| `temporary-without-expires`  | warning | kind=temporary (または未指定) かつ expires が空 |

既存の `expired`, `expiring-soon` は temporary のものにのみ適用される。`VerifyIssueType` union type に2つの値を追加する。

### 5. 段階的導入

- kind の語彙は規約であり、バリデーションはデフォルトで warning (error にはしない)
- v0.0.1 でユーザー不在のため、既存レジストリの kind 未指定 → temporary 扱いへの移行は破壊的変更の影響なし
- `shiori doctor` の upgrade wizard で kind 付与を案内する
- 既存の単一スコア表示は deprecated として一定期間維持し、二軸表示に移行する

## Consequences

### 利点

- 恒久的な disable を「負債」ではなく「記録された意思決定」として正当に扱える
- 「何も考えずに登録」すると temporary 扱いで expires を要求されるため、意思決定を自然に促す
- intentional + reason の要求により、雑な逃げを抑制しつつ正当なケースは認める
- Coverage と Hygiene の分離で、ガバナンスの状況をより正確に伝えられる
- draft（shiori: マーカーのみ）でも Coverage に寄与するため、段階的な導入を阻害しない

### 欠点・リスク

- スコア体系の変更により、既存の health スコアとの連続性が失われる
- CI 設定で2つの閾値が必要になる（単一閾値より複雑）
- kind の語彙が今後増える可能性があり、拡張ポイントの設計が必要
- intentional の比率が異常に高い場合の検知は将来課題とする

### 影響範囲

- `src/commands/report.ts`: `calculateScore()` → 二軸スコア再設計
- `src/commands/health.ts`: 二軸スコア表示対応
- `src/commands/verify.ts`: 新しい issue type の追加
- `src/core/types.ts`: `HealthResult` 型の拡張、`VerifyIssueType` に2値追加
- `src/commands/health-cli.ts`, `report-cli.ts`: 出力フォーマットの更新
- `src/commands/check-cli.ts`: `--coverage-threshold`, `--hygiene-threshold` フラグ追加
- `src/commands/doctor/`: upgrade wizard での kind 付与案内
