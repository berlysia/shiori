---
status: Accepted
deps:
  - 36
---

# ADR-037: bumpp を changesets と release コマンドに替える

## Status

Accepted

後半（Release run の待機、stage の照合、approve、公開後の確認）は保留であり、未実装である。この ADR が実装済みと言えるのは、tag の push までである。

## Context

リリースのたびに、版を 2 回入力していた。`/changelog X.Y.Z` で root の `CHANGELOG.md` に `## [X.Y.Z] - YYYY-MM-DD` の節を書き、その後の `pnpm run release` で bumpp の対話に同じ版を入れた。`check-changelog.ts` は 2 つの値が一致するかを後から確かめるだけで、版の入力元は 2 つのままだった。

push の後は、Actions の画面で待ち、`npm stage list` / `view` / `download` と validate の log の integrity を目で照合していた。中断すると、どこまで進んだかを人が調べ直した。

この ADR の作業の動機は、版の二重入力をなくすことである。回収できる手作業の時間は小さい。リリースは数か月に 1 回であり、待ち時間の大半は CI にある。

利用者は次を決めた。

- 置き換え先は changesets とする。
- 範囲は approve までとする。
- CHANGELOG は changeset の本文から作る。
- prerelease は pre mode で出す。

参考にしたのは kanbun-annotation のリリースの作りである。kanbun-annotation は、同じ npm の staged publishing の上で、版の正本を変更ごとの記録に置き、外部の状態から次の操作を決める形を実装し、v0.2.0 を出した。

ADR-036 は、tag 起点の stage と、人のゲートとしての npm の 2FA approve を決めた。この ADR は、tag を作って push するまでの手順と、版の決め方を替える。

## Decision

### 版の正本は changeset であり、changesets は版の計算と pre mode だけに使う

- `@changesets/cli` を root の devDependency に exact `2.29.8` で入れる。`bumpp` は外す。
- `.changeset/config.json` は `changelog: false`、`commit: false`、`access: "public"`、`baseBranch: "master"`、`ignore: ["@berlysia/shiori-daemon", "@berlysia/shiori-vscode"]`、`updateInternalDependencies: "patch"` とし、ほかのキーは持たない。
- `changelog` や `commit` にモジュールのパスが入ると、`changeset version` が手元でそのコードを読み込む。このため、段 1 で config.json がこの値と完全に一致することを確かめる。
- daemon と vscode は ignore に入れる。両方に `private: true` は付けない。公開するかどうかは別の判断である。
- changeset の対象は `@berlysia/shiori` だけである。vscode 拡張、composite action、`shiori init` のテンプレートなど、利用者に見える変更も、shiori の版の節に書く。

### changeset の本文の形式と検査

changeset の本文は Keep a Changelog の小見出しで書く。

- frontmatter は `"@berlysia/shiori": patch|minor|major` の 1 行だけである。ほかのパッケージ名は失敗にする。
- 本文は、`### <小見出し>` の行、`- ` で始まる項目の行、空行だけからなる。
- 小見出しは `Breaking Changes` / `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` に限る。
- 項目は 1 行で完結する。継続行と入れ子は認めない。
- `- ` の後が空白だけの項目は拒否し、行末の空白は生成のときに除く。
- 最初の行（空行を除く）は小見出しとする。小見出しごとに項目を 1 つ以上持たせ、同じ小見出しは 2 回書かない。

次のものは拒否する。

- 上記以外の行。`#` で始まる行、コードフェンス、`<` で始まる行を含む。
- CR。
- 制御文字。C0 のうちタブ以外、C1、ESC。
- bidi 制御文字（U+202A–U+202E、U+2066–U+2069）。
- 64 KiB を超える本文。

`CHANGELOG.md` の `## [Unreleased]` と次の `## [` の間は、空行だけにする。`[Unreleased]` は空に保つ。

検査は `pnpm run check:changesets` が行い、CI が呼ぶ。段 1 も同じ検査を行う。門は段 1 であり、CI は早く知らせるためにある。外れたときは、ファイル名・行番号・理由を出して exit 1 にする。

上げ幅と `Breaking Changes` の対応は検査しない。0.2.2 は Node 22 必須を patch で出した。上げ幅は人が選ぶ。

### CHANGELOG の節の生成

stable の版上げで、changeset の本文から root `CHANGELOG.md` の節を作る。prerelease では作らない。

- 消費する changeset は、`changeset version` の直前に `.changeset/` にある `*.md`（README.md を除く）のすべてである。pre mode では、使用済みの changeset の md が `pre exit` の後の `version` まで残る。したがって stable の版上げの直前に残っている md の集合が、前の stable 以降のすべての changeset になる。
- 段 2 は、`pre enter` / `pre exit`、`changeset status --output`、md の集合の読み取り、`changeset version` の順に進む。`--exit-pre` のときに pre mode のまま status を読むと、rc で消費済みの changeset が除かれて版が欠けるため、pre の操作を先に行う。pre の操作が書き換えるのは `.changeset/pre.json` だけである。
- 節は `## [Unreleased]` の直下に `## [X.Y.Z] - YYYY-MM-DD` として挿入する。小見出しは上の順で、ある分だけ並べる。
- 日付は、実行した機械のローカル日付である。テストでは clock を注入する。
- 同じ小見出しの項目は、changeset の順にまとめる。changeset の順はファイル名の昇順である。changesets のファイル名はランダムな語なので時系列ではない。git の履歴は rename・squash・shallow clone で順序が環境に依存するため使わない。
- 生成した節は、`hasChangelogSection(changelog, version)` が真になる。節の本文を本文の解析器で読み戻すと、元の項目の集合に一致する。同じ入力から 2 回作ると同じ文字列になる。
- `check-changelog.ts` は、stable の節に `- ` の項目が 1 つ以上あることも求める。生成で項目が落ちたとき、release.yml のこの検査が最後に止める。

### version.ts は package.json の版に同期する

`changeset version` の後に、`packages/shiori-cli/src/core/version.ts` の `export const VERSION = '<版>';` の行を、正規表現 `^export const VERSION = '[^']+';$`（m フラグ）でちょうど 1 か所置換する。0 か所または 2 か所以上なら止まる。書き換える版は、厳密な semver の検査を通したものだけである。

ビルド時には導出しない。

- shiori-cli のビルドは `tsc` であり、置換の仕組み（define）がない。
- 生成ファイルにすると、typecheck・test・bundle（esbuild）の前に毎回生成の手順が要る。新しい worktree では、生成の前に typecheck が落ちる。
- 実行時に package.json を読む案は、dist と bundle で相対の深さが違うため採らない。

同期は段 2 の 1 か所に閉じる。`tests/version.test.ts` が drift を見張る。

### release コマンドの構成

`pnpm run release` は `scripts/release/release.ts` を実行する。kanbun-annotation の commit `72611ec` の `release.ts` と関連する lib を移植し、単一パッケージに削った。以後は kanbun-annotation と独立に保守する。上流の修正は、必要なときに手で取り込む。

再開は外部の状態から決め、進捗のファイルを持たない。「approve まで 1 コマンド」は数十分かかる。品質検査と CI の待機があるためであり、途中の中断は避けられない。進捗のファイルを持つと、手で 1 回 approve したなどで外部と食い違ったときの回復手順が要る。外部の状態は、どの中断地点でも区別できる。

フラグは `--pre <tag>`（`^[a-z]+$`）と `--exit-pre` だけであり、排他である。未知のフラグと位置引数はエラー（exit 1、何も変えない）にする。approve を飛ばすフラグは作らない。`--tag-only` も作らない。validate が失敗したら、修正して patch で出し直す。

入口は、TTY（stdin と stdout）、npm と gh の版、registry、外部の状態を観測し、純粋関数 `decideEntry` で次の行動を決める。上から順に最初に当たる行を使う。

| #   | 条件                                                                    | 結果                                                                            |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 0   | 観測に失敗（git / npm / gh のエラー、JSON の形が違う）                  | 止まる。何も変えない                                                            |
| 1   | 作業ツリーが clean でない                                               | 止まる。段 2〜5 の残りなら戻すコマンドを表示する                                |
| 2   | origin に `vV` があり、その commit が HEAD、V は未公開                  | 後半（保留。仮の停止）                                                          |
| 3   | origin に `vV` があり、V は公開済み、フラグなし、status に出す版がない  | 確認だけ（保留。仮の停止）                                                      |
| 4   | origin に `vV` があり、その commit が HEAD でない、V は未公開           | 止まる。`git switch --detach vV` してから再実行するよう表示する                 |
| 5   | local に `vV` があり、origin にない                                     | 止まる。送り直すコマンドと戻すコマンドを表示する（実行しない）                  |
| 6   | HEAD の message が `chore: release vV`、`vV` がどこにもない、V は未公開 | 段 5 の commit の後に中断した状態。前提を確かめ直して、段 5 の tag から再開する |
| 7   | `--pre` または `--exit-pre`                                             | 前半                                                                            |
| 8   | status が `@berlysia/shiori` の版を出す                                 | 前半                                                                            |
| 9   | pre mode で、status に出す版がない（使用済みの changeset だけ）         | 止まる。changeset を足すか `--exit-pre` を付けるよう表示する                    |
| 10  | status に出す版がない                                                   | 止まる。出すものがない（exit 0）                                                |
| 11  | status が失敗                                                           | 止まる                                                                          |

status は遅延して評価する。使うのは行 3 と行 8〜11 だけであり、status の失敗が後半の再開を止めないためである。各行は、一時 git repo と bare remote のテストで固定する。

前半の段は次のとおりである。

1. 前提。master で clean、fetch の後に origin/master と一致していることを確かめる。config.json、trust、tag ruleset、environment を確かめる。changeset の形式と `[Unreleased]` を検査する。品質検査（`typecheck`、`lint`、`lint:boundaries`、`lint:envelope`、`format:check`、`build`、`test`）を通す。
2. 版上げ。pre の操作、`changeset status`、`changeset version` を行い、ignore 済みパッケージの変更を戻す。stable なら CHANGELOG の節を生成し、version.ts を同期し、許可リストを検査し、oxfmt をかけ、許可リストを再検査する。
3. 公開前提。tag と版が合うこと、版が npm に未公開であること、tag が local にも origin にもないことを確かめる。stable なら、CHANGELOG の節があることと、latest より新しいことも確かめる。
4. 確認。版、dist-tag、変更ファイルを表示して y/N を聞く。
5. commit と tag。許可パスだけを `git add` し、`git diff --cached --name-only` が許可リストに当たる変更の集合と完全に一致することを確かめてから commit する。commit の直後に、`git diff-tree` の結果が同じ集合であることを確かめてから、annotated tag `vX.Y.Z` を打つ。
6. push。environment と ruleset を読み直してから `git push --atomic origin refs/heads/master:refs/heads/master refs/tags/vX.Y.Z:refs/tags/vX.Y.Z` を実行する。

許可リストは次のとおりである。

- `packages/shiori-cli/package.json`（変更）
- `packages/shiori-cli/src/core/version.ts`（変更）
- `CHANGELOG.md`（変更。stable のみ）
- `.changeset/*.md` の削除（README.md を除く。stable のみ）
- `.changeset/pre.json` の追加・変更・削除

commit は `git commit --no-verify -m "chore: release vX.Y.Z"` で行う。`--no-verify` にする理由は、pre-commit hook（`.husky/pre-commit`、hook はこれだけ）が `.fallowrc.json` を再生成して `git add` するためである。許可リスト外のファイルが release commit に入る経路を閉じる。整形は段 2 で oxfmt を許可パスにかけて済ませる。

push は `--atomic` で branch と tag をまとめて送る。bumpp は branch と `--tags` を別々に送り、local の tag をすべて送っていた。

### kanbun-annotation から外したもの

- `fixed` グループの契約と、複数パッケージの版の一致。
- 依存順の approve と、部分 approve の窓。
- 空の CHANGELOG 節の補完。
- 内部依存の exact range の検査。
- 利用者テスト（`test:consumer`）。
- `--tag-only`。
- 0.2.0 専用の `check-version-bump.mjs` の分岐。
- artifact の `manifest.json` との照合。

移植で残したものは、入口の判定表、許可リストと ignore 済みの戻し、`Deps` の注入とテストの形、止まるときの分類、表示の無害化、根拠の保存である。

### 前提の確認は fail-closed にする

段 1 と、push の直前に、次の前提を読んで確かめる。読めない、形が違う、内容が違う、のどれでも止まり、先に進まない。止まるときは、生の出力の保存先と、`docs/releasing.md` の手作業の確認手順を表示する。

- `npm trust list @berlysia/shiori --json` のエントリがちょうど 1 件で、`type: github`、`file: release.yml`、`repository: berlysia/shiori`、`environment: npm`、`permissions` がちょうど `["createStagedPackage"]`。`--json` は、エントリが 1 件のときオブジェクトとして返す。このためオブジェクトも受け入れる。
- `gh api` で、environment `npm` の deployment branch policy が tag `v*` の 1 件だけであること。
- tag ruleset が `refs/tags/v*` の作成・更新・削除を制限し、bypass が admin ロールだけであること。
- origin の URL が `berlysia/shiori` であること。
- `.changeset/config.json` が期待値と一致すること。

environment と ruleset は、段 1 に加えて段 6 の push の直前にも読み直す。どちらも読むだけで 2FA が要らないためである。trust は 2FA が要るので、段 1 だけで確かめる。

ADR-036 D3 の安全性は、npm 側と GitHub 側の両方の設定に依る。npm 側の trust は、直接 publish をさせない。GitHub 側の保護は、admin しか `v*` を打てず、`v*` からしか stage できないようにする。この前提が崩れていないことを、機械で確かめる。

### 外部コマンドと端末の出口

- 外部の値は検証してから使う。版は `changeset status` と package.json から読んだ直後に、厳密な semver（`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`）で検査し、通った値だけを tag 名・commit message・version.ts・CHANGELOG・引数に使う。stage id は UUID の正規表現、run id と job id は整数で検査する。
- 子プロセスは引数配列で呼び、shell を経由しない。`gh` には常に `--repo berlysia/shiori` を付ける。`gh api` は `--repo` を受けないので、パスに `repos/berlysia/shiori/...` を書き、`--method GET` を付ける。`npm` には常に `--registry https://registry.npmjs.org/` と `--@berlysia:registry=https://registry.npmjs.org/` を付ける。入口で `npm config get registry` の実効値も確かめる。
- 子プロセスの環境変数から `GH_HOST`、`GH_REPO`、`GH_ENTERPRISE_TOKEN`、`NODE_OPTIONS`、`NODE_PATH`、`LD_PRELOAD`、および `npm_config_` で始まるもの（大文字小文字を問わない）を除く。除いた変数の名前は表示し、値は出さない。除く集合は単体テストで固定する。
- `GH_TOKEN`、`GITHUB_TOKEN`、`GIT_*`、proxy と CA の変数は除かない。gh の認証、git の ssh の設定、社内 proxy の正当な使い方を壊すためである。
- 外から来る文字列（log、`npm stage list`、`npm view`、changeset の本文）は、制御文字（C0、C1、ESC、bidi 制御、Cf）を除いてから、出口の 1 関数を通して表示する。出口は `scripts/release/output.ts` だけである。`deps.ts` から分けたのは、出口以外の `console` / `process.stdout.write` の禁止を、構造テストでファイル単位に検査するためである。
- 出力を端末の出口に通さず inherit で流すのは、repo が管理するコマンド（段 1 の品質検査の `pnpm` scripts、`changeset`、`oxfmt`）と、2FA を通すための対話の `npm trust list` の 2 種類だけである。対話の `npm trust list` の出力は判定に使わない。判定は、続けて取る `--json`（pipe で受け、無害化を通す）だけで行う。
- 生の出力を `.tmp/release/v<版>/<時刻>/` に保存する（ディレクトリは 0700、ファイルは 0600）。版が決まる前は `.tmp/release/pending-<時刻>/` に書き、段 2 で版が決まったら `v<版>/<時刻>` へ移す。版が決まらずに止まったときは pending のまま残す。`changeset status --output` の出力先もこの下に置く。形が期待と違って手作業に回るときの材料にする。

### 層の規則と後半の継ぎ目

- `scripts/release/lib/` には純粋関数と型だけを置く。I/O を持たず、`deps.ts`、`output.ts`、`release*.ts`、`check-changesets.ts` を import しない。
- lib が import してよい repo 内の外のファイルは、`packages/shiori-cli/scripts/check-changelog.ts` の `hasChangelogSection` だけである。CHANGELOG の見出しの形式の正本を 1 か所に保つため、例外として認める。
- `Deps` の型は `lib/types.ts` に置き、`deps.ts` が実装する。`release.ts` が構成ルートであり、`Deps` を組み立てる。テストは偽の `Deps` を渡す。
- 依存の向きは、`release.ts` から `release-after-push.ts` / `deps.ts` / `lib/`、`release-after-push.ts` から `lib/`、`deps.ts` から `lib/` だけである。これ以外の向きは `scripts/release/layers.test.ts` で禁じる。
- 後半の継ぎ目は `release-after-push.ts` の `enterAfterPush(deps, decision)` である。行 2 と行 3 の仮の停止だけを持つ。仮の停止の exit code は、後半の実装で決め直す。

### 段 2 の status の検査

`pre exit` の後の `changeset status` は、ignore 済みの daemon を `type: patch`、`changesets: []` として出す。このため段 2 の整合の検査は、ignore 名の release を、`changesets` が空のときだけ無視する。ignore 名の release に changeset が付いていれば止まる。この挙動は `changesets-behavior.test.ts` が canary として固定する。

### 入口の作業ツリーと git の向き先の検査

入口で、観測する repo と書き込む repo のずれを止める。`GIT_DIR` などは子プロセスの環境に残るためである。

- `git rev-parse --show-toplevel` が cwd と、realpath で一致する。
- `git rev-parse --absolute-git-dir` が、`<cwd>/.git` がディレクトリならそのパス、通常ファイルなら中の 1 行 `gitdir: <パス>` のパス（相対なら cwd から解決）と、realpath で一致する。
- `<cwd>/.git` が読めない、ディレクトリでも通常ファイルでもない、`gitdir:` の行の形でない、のどれでも止まる。

git worktree では `.git` が `gitdir:` のファイルになる。`<cwd>/.git` との一致だけを求めると、正しい作業ツリーでも止まる。

### 行 6 の再開で受け入れること

行 6 の再開は、段 4 の y/N を繰り返さない。このため、CHANGELOG の節の本文と `.changeset/pre.json` の中身の改変は、見出しと形が合えば通る。手元の作業ツリーに書き込める者は、すでにリリースを操作できるため、受け入れる。HEAD の親が origin/master であること、HEAD の差分が許可リストに収まること、package.json の中身が段 2 で作るものと合うことは確かめる。外れたら止まり、`git reset --hard origin/master` を表示する。

### root の script と devDependencies

スクリプトは root の `scripts/release/` に置き、root の test / typecheck / lint に入れる。

- `test:scripts`: `node --experimental-strip-types --test "scripts/release/**/*.test.ts"`
- `typecheck:scripts`: `tsc -p scripts/release/tsconfig.json`
- `lint:scripts`: `oxlint scripts/release --deny-warnings`

root の `test` / `typecheck` / `lint` は、`pnpm -r ...` の後にこれらを呼ぶ。`pnpm -r` は root を含まないため、明示的に呼ぶ。root の devDependencies に、`@changesets/cli`（`2.29.8`）、`typescript`（`7.0.2`）、`oxlint`（`1.85.0`）、`@types/node` を exact で入れる。

### 後半は保留とする（未実装）

次の部分は保留であり、未実装である。

- `release.yml` の validate に、manifest を出す step を足すこと。
- Release run の待機。
- log の manifest を錨にした stage の照合。
- approve。
- 公開後の確認。
- `workflow-structure.test.ts`。

設計の要点と、始める条件は [docs/plans/release-approve-automation.md](../plans/release-approve-automation.md) に置く。

保留の理由は次のとおりである。

- 前半の段 1〜6 が、実際のリリースを通っていない。
- 移植の規模が大きい。kanbun-annotation の後半は `release-after-push.ts` 1385 行と `release-after-push-check.ts` 1605 行である。
- 保守する人が 1 人である。
- 主な動機（版の二重入力をなくす）は、前半で満たした。

見直す条件は、前半が実際のリリースで段 6 まで通った後であることとする。

後半が入るまで、push の後は `docs/releasing.md` の手作業で続ける。

### 却下した案

- **changesets の CHANGELOG の形式に移る案**: 既存の root `CHANGELOG.md`（Keep a Changelog の形式）との連続性を失う。`changelog: false` にして、changeset の本文から root の節を作る。
- **changesets を版の計算だけに使う案**: 利用者の決定により、CHANGELOG は changeset の本文から作る。
- **最小の自作案**: 中断からの再開を人がフラグで選ぶので、選び間違えたときに、未完了のリリースの上に次の操作を積む。pre mode の不具合の戻しと、実物の changeset を一時 repo で動かすテストも作り直すことになる。
- **version.ts のビルド時の導出**: 上記のとおり、`tsc` に置換の仕組みがなく、生成の手順が要る。
- **artifact の manifest.json から dist-tag を決める案**: 信頼できない入力に判断を移すことになる。dist-tag は従来どおり、tag 名から決める。
- **環境変数の allowlist**: gh の資格情報の取得（keyring が使う `DBUS_SESSION_BUS_ADDRESS` など）や、git の ssh の設定を壊しうる。除く変数を列挙する。
- **CHANGELOG の見出しから版を読む自前の script（旧計画の案 A）**: 版の入力元が CHANGELOG の見出しに変わるだけである。changeset のように、変更ごとの記録から版と上げ幅を導けない。
- **release-please**: commit の種別で上げ幅が決まり、人が選べない。0.2.2 は Node 22 必須を patch で出した。

## Consequences

### ADR-036 のうち変わらないもの

ADR-036 の D1〜D4 は有効である。tag 起点の stage、検証済み tarball、trusted publisher と environment の二重束縛、npm CLI の固定は変えない。人のゲートは、npm の 2FA approve のままである。

ADR-036 の Consequences は、approve 前確認を「人による唯一の内容確認」と書く。後半が保留の間は、これが変わらない。人が目で、版、ファイル、integrity を、validate の log に対して照合する。機械の照合はまだない。

### 脅威と統制、受容するリスク

- **log の錨は validate の job の乗っ取りを防がない（R6）**: tarball と log の表は、同じ job が出す。validate の中の依存コードが両方をそろえて書き換えれば、照合は通る。このリスクが機械の照合にかかわるのは、後半を実装した後である。今は、人の目視が同じ錨を見ている。守る範囲は変わらない。
- **環境変数の除外は列挙である（R7）**: `GH_TOKEN`、`GIT_*`、proxy・CA・`GH_CONFIG_DIR` などは子プロセスに渡る。direnv / mise や AI エージェントの作業環境の変数が、メンテナのシェルに混ざる経路もある。環境変数で照合を偽れても、取り消せない操作（approve）は、人の 2FA で縛られている。除いた変数の名前は毎回表示する。
- **changesets の不具合の回避は 2.29.8 に依存する（R3）**: pre mode で ignore 済みパッケージの版が上がる不具合の戻しは、`@changesets/cli` を exact で固定して成り立つ。不具合が直ると canary のテストが落ち、戻しを消す合図になる。pre mode のために払う費用は、戻しの処理、再現テスト、判定表の行である。
- **changeset の書き忘れ（R4）**: 書き忘れた利用者に見える変更は、CHANGELOG に載らない。PR ごとの changeset の有無は検査しない。利用者に見えない変更も多いためである。リリースの前に `/changelog` で、前の stable tag 以降の commit から、changeset のない変更の下書きを作る。
- **changesets の依存木が増える（R8）**: devDependencies の依存木が増える。exact で固定し、`minimumReleaseAge`（1 週間）の下で入れる。changesets のコードが動くのは段 2 の `changeset` の呼び出しであり、config.json の検査でモジュールの読み込みを閉じる。
- 前半の段 1〜6 は、実物のリリースを通っていない。
- `release.ts` は 1226 行であり、計画で置いた閾値の 800 行を超えた。後半を再開するときに、段ごとに分けるかを判断する。

### 実装で分かった事実

- 2026-10-25: GitHub の environment `npm` は `custom_branch_policies: true`、`protected_branches: false` で、policy は `{v*, tag}` の 1 件である。tag ruleset（id 24324650）は `refs/tags/v*`、exclude なし、creation / update / deletion を制限し、bypass は admin ロール（`actor_id: 5`、`always`）だけである。`npm trust list @berlysia/shiori --json` はエントリ 1 件で、オブジェクト 1 つを返した（`file: release.yml`、`repository: berlysia/shiori`、`environment: npm`、`permissions: ["createStagedPackage"]`）。旧 `publish.yml` の trust はない。
- 2026-10-25: 対話の `npm trust list` は、inherit の例外として残す。npm 12.2.0 の `otplease` は、stdin と stdout の両方が TTY でなければ対話に入らずにエラーを投げる。これは kanbun-annotation の ADR-031 に、ソースを読んだ記録として残る。
- 2026-10-25: `git log v0.3.0..HEAD` を見直し、利用者に見える変更はないと判断した。移行時の changeset は書かなかった。
- 2026-10-25: `pre exit` の後の `changeset status` が、ignore 済みの daemon を `type: patch`、`changesets: []` で出すことを、plan-1 と plan-2 の実装で別々に観測した。当初の段 2 の整合（`type !== none` は shiori の 1 件だけ）では `--exit-pre` が必ず止まる。そこで、logic-validator の確認を経て、ignore 名の release を `changesets` が空のときだけ無視する整合に改めた。
- 2026-10-25: 依存されていない ignore 済みパッケージは、`changeset status` に出ない。
- 2026-10-25: Claude Code の `!` は、stdin と stdout を端末としてつながないため、入口の TTY の検査で止まる。リリースは普段の端末で実行する。
- 2026-10-25: worktree の `.git` は `gitdir:` のファイルである。入口の git の向き先の検査が、これを考えておらず、スモークで止まった。
- 2026-10-25: 実物のスモークで `npm view <pkg> dist-tags --json` が、要素 1 つの配列として返ることを確かめた（npm 12.2.0）。object か、object 1 つの配列を受け入れる。
- 2026-10-25: master より進んだ branch では、`changeset status` が「changeset なし」で失敗する。失敗の理由を表示するようにした。
- 2026-10-26: master で changeset なしの `pnpm run release` は、行 3 の仮の停止で止まり、exit 0 になる。普段の端末でのスモークで確かめた。

### plan と実装の差

- golden は、CHANGELOG の抜き出しとした（plan-1 T4）。
- テストと実装を同時に書き、Red の手順を踏まなかった（plan-1 の実装）。
- 行 1 の「版上げの残り」を、ignore 済みの package.json の M に狭めた（plan-2 の実装）。
- `.git` ファイルだけでは、別の repo を指すかを見分けられない。git はそのファイルに従い、2 つの rev-parse の答えが一致するためである。`GIT_DIR` や `GIT_WORK_TREE` との食い違いがあるときだけ、止まる（plan-2 の実装）。
