# ADR 006: 候補（candidate）自動検出と shiori:ignore

## Status

Proposed

## Context

現在の shiori は `shiori:` マーカーの有無でアノテーションの管理対象を決定している。`shiori:` なしの lint disable コメントは Path C として「malformed」扱いされるが、これは実態に合わない。`shiori:` を書いていないコメントは単に「shiori の管轄外」であり、壊れている（malformed）わけではない。

一方で、lint disable コメントや TODO/FIXME/HACK などのコメントは、潜在的に shiori で管理すべき候補である。これらを自動検出して一覧できれば、開発者は普通にコードを書くだけで shiori が管理候補を拾い上げてくれる。

### 現状の問題

1. **malformed の誤用**: `shiori:` なしの lint disable は malformed ではなく、単に未管理
2. **検出範囲の限界**: lint disable 以外のパターン（TODO, FIXME, HACK 等）を拾えない
3. **ADR 003 との不整合**: `ref` の必須性が「なければ malformed 扱い」と定義されているが、draft（ADR 005）で ref 空文字列を正当な状態として認めた時点でこの前提は既に崩れている

### ADR 003 の tag フィールドとの関係

ADR 003 の内部モデルで `tag?: string // TODO, FIXME 等（将来拡張）` とコメントされていたが、現在の `ShioriAnnotation` には実装されていない。本 ADR の候補検出はこの拡張ポイントを具体化するものである。

## Decision

### 1. malformed の再定義

現在の `malformed` は2つの異なる状況を混同している:

- (a) `shiori:` マーカーがない lint disable コメント → 管轄外であり、壊れていない
- (b) `shiori:` マーカーがあるが構文が壊れている → 実際の構文エラー

(a) は malformed ではなく候補（candidate）として再分類する。(b) は `syntax-error` として `VerifyIssueType` に残す。

```typescript
// (a) candidate — malformed ではない
// eslint-disable-next-line no-console

// (b) syntax-error — 実際の構文エラー
// eslint-disable-next-line no-console -- shiori: ref=
// shiori: =invalid
```

`VerifyIssueType` の変更:

```
'malformed' → 削除
'syntax-error' → 新規追加（shiori: マーカーありだが構文が壊れている場合）
```

### 2. 候補（candidate）の導入

設定で指定したコメントパターンにマッチし、かつ `shiori:` マーカーがないコメントを「候補（candidate）」として検出する。候補は tracked でも draft でもなく、shiori 管理に組み入れるかどうかの判断待ち状態である。

#### 検出パターン

| カテゴリ     | パターン例                                | デフォルト         |
| ------------ | ----------------------------------------- | ------------------ |
| lint disable | `eslint-disable-*`, `stylelint-disable-*` | 有効               |
| TODO 系      | `TODO`, `FIXME`, `HACK`, `XXX`            | **無効（opt-in）** |

- lint disable はプロジェクトで shiori を使う以上、常に候補となるためデフォルト有効
- TODO 系は大規模プロジェクトで大量に出現し候補一覧のノイズになり得るため、opt-in とする
- パターンは設定ファイルで追加・除外できるようにする

#### 候補の状態遷移

```
候補（candidate）
  ├─ shiori: ref=X を付与 → tracked
  ├─ shiori: を付与（ref なし）→ draft
  ├─ shiori:ignore を付与 → ignored
  └─ 何もしない → 候補のまま（一覧に出続ける）
```

状態遷移は開発者がソースコメントを手動編集して行う。自動変換 CLI は本 ADR のスコープ外（将来の拡張として検討可能）。

### 3. shiori:ignore の導入

管理不要と判断したコメントに `shiori:ignore` マーカーを付与して、候補一覧から除外する。

```ts
// eslint-disable-next-line no-console -- shiori:ignore
// TODO: this is fine -- shiori:ignore
```

#### パース仕様

`shiori:ignore` は `parseShioriFields` に渡される前に CommentProvider で検出する。現在のパーサでは `shiori:ignore` が bare ref shorthand として `ref: 'ignore'` にパースされてしまうため、`shiori:` プレフィックスマッチ後、フィールド解析前に `ignore` を分岐する。

```
CommentProvider: shiori: プレフィックス検出
  ├─ 直後が "ignore" → ignored として処理（parseShioriFields を呼ばない）
  └─ それ以外 → parseShioriFields で通常パース
```

#### shiori:ignore と他フィールドの共存

`shiori:ignore` は単独で使用する。他のフィールドとの同時指定は不正とする:

```ts
// ✅ 正しい
// eslint-disable-next-line no-console -- shiori:ignore

// ❌ 不正（syntax-error として報告）
// eslint-disable-next-line no-console -- shiori:ignore ref=SUP-1234
// eslint-disable-next-line no-console -- shiori: ref=SUP-1234 ignore
```

ref がある場合は tracked として管理すべきであり、ignore と矛盾する。

### 4. draft の維持

ADR 005 の draft（`shiori:` マーカーあり + ref なし）は維持する。candidate と draft は明示的度合いが異なる:

- **candidate**: shiori が自動検出した管理候補。開発者は shiori を意識していないかもしれない
- **draft**: 開発者が意図的に `shiori:` を書いた。「管理したい」という意思表示がある

この区別は運用上重要であり、開発者の意図を正確に表現するために両方残す。

`shiori draft` コマンドは引き続き draft のみを一覧する。候補一覧は別コマンド（`shiori candidates` 等）として提供する。

### 5. コメント分類の再整理

| 条件                            | 分類         | scan 出力 | verify 対象 |
| ------------------------------- | ------------ | --------- | ----------- |
| `shiori: ref=X` あり            | tracked      | あり      | あり        |
| `shiori:ignore` あり            | ignored      | あり      | なし        |
| `shiori:` あり + ref なし       | draft        | あり      | なし        |
| `shiori:` あり + 構文壊れ       | syntax-error | あり      | あり        |
| パターンマッチ + `shiori:` なし | candidate    | あり      | なし        |
| 上記いずれにも該当しない        | —            | なし      | なし        |

### 6. 型設計の方向性

candidate は `shiori:` マーカーを持たないため、現在の `ShioriAnnotation`（shiori マーカーに基づくアノテーション）とは質的に異なる。scan 結果の型を分離する:

```typescript
/** shiori: マーカーを持つアノテーション */
interface ShioriAnnotation {
  ref: string;
  rule?: string;
  expires?: string;
  reason?: string;
  ignored: boolean; // shiori:ignore の有無（tagged を置き換え）
  location: { file: string; line: number };
}

/** shiori: マーカーを持たない管理候補 */
interface ShioriCandidate {
  /** 検出パターンのカテゴリ（"lint-disable", "todo" 等） */
  pattern: string;
  rule?: string; // lint disable の場合のルール名
  text?: string; // TODO テキスト等
  location: { file: string; line: number };
}

/** scan コマンドの出力 */
interface ScanResult {
  annotations: ShioriAnnotation[];
  candidates: ShioriCandidate[];
}
```

`tagged` フィールドは廃止する。`shiori:` マーカーの有無は `ShioriAnnotation` と `ShioriCandidate` の型分離で表現される。`ignored` フィールドが `shiori:ignore` の有無を表す。

## Rationale

### malformed 再定義の理由

`shiori:` マーカーを書いていないコメントが「壊れている」というのは不正確。shiori の管理下に入れるかどうかは開発者の判断であり、マーカーなしは単に「管理対象として選択されていない」状態にすぎない。一方で `shiori:` マーカーがあるのに構文が壊れているケースは実際のエラーであり、syntax-error として報告する価値がある。

### 候補の自動検出の理由

- 開発者の通常のワークフロー（lint disable や TODO を書く）を変えずに、shiori が管理候補を拾い上げられる
- パターンを設定可能にすることで、プロジェクトごとの慣習に対応できる
- TODO 系を opt-in にすることで、大量の候補によるノイズを避けられる

### draft を維持する理由

- candidate は shiori の自動検出であり、開発者の意思が入っていない
- draft は開発者が意図的に `shiori:` を書いた意思表示である
- 明示的度合いの違いは運用上有意味であり、両方を別概念として残すことで開発者の意図を正確に表現できる

### shiori:ignore の理由

- 候補を自動検出すると、管理不要なコメントもノイズとして出てくる
- `shiori:ignore` で明示的に除外することで、「検討済みで管理不要」という判断を記録できる
- 何もしなければ候補一覧に出続けるため、意図的な除外との区別がつく

### 却下した代替案

- **malformed を untracked にリネームして残す案**: lint disable に shiori マーカーを強制するポリシーは、候補一覧とプロジェクトルールの組み合わせで実現可能。verify 側に untracked を持つ必要はない
- **候補を `ShioriAnnotation` に統合する案**: `shiori:` マーカーの有無は質的な違いがある。型分離の方が各コンテキストでの取り扱いが明確
- **ファイル/ディレクトリ単位の除外（`.shioriignore`）**: 将来の拡張として有用だが、本 ADR のスコープを超える。まずはコメント単位の `shiori:ignore` で最小限を実現する

## Migration Strategy

### Phase 1: malformed → syntax-error

- `VerifyIssueType` から `'malformed'` を削除し、`'syntax-error'` を追加
- verify の malformed チェック（`ref === '' && !record.tagged`）を削除
- `shiori:` マーカーありかつ構文エラーのケースを syntax-error として検出するロジックを追加

### Phase 2: shiori:ignore 対応

- CommentProvider で `shiori:ignore` をパース前に検出する分岐を追加
- `ShioriAnnotation` に `ignored: boolean` を追加、`tagged: boolean` を廃止
- verify で ignored アノテーションを対象外にする

### Phase 3: candidate 検出

- `ShioriCandidate` 型を追加
- CommentProvider（または別 Provider）で候補パターン検出を実装
- デフォルトで lint disable パターンを有効化
- scan コマンドの出力を `ScanResult` 型に変更

### Phase 4: コマンド・設定

- `shiori candidates` コマンドを追加
- 候補検出パターンの設定機構を実装（設定ファイル仕様は別途設計）
- TODO 系パターンの opt-in 設定を追加

## Consequences

- `VerifyIssueType` から `'malformed'` が削除され `'syntax-error'` が追加される
- `ShioriAnnotation` の `tagged` フィールドが `ignored` フィールドに置き換わる
- scan コマンドの出力型が `ShioriAnnotation[]` から `ScanResult`（annotations + candidates）に変更される
- `shiori candidates` コマンドが追加される
- `shiori draft` コマンドは変更なし（draft アノテーションのみ一覧）
- 破壊的変更だが、ユーザー不在のため影響なし

### 他 ADR への影響

- **ADR 003**: `ref` の必須性を「tracked アノテーションでは必須」に緩和。「なければ malformed」の記述は本 ADR により supersede
- **ADR 005**: draft の定義と `shiori draft` コマンドは維持。`tagged` フィールドの廃止に伴い、draft の判定条件を `ref === '' && !ignored` に変更
