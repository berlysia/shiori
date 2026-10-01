---
status: Accepted
deps:
  - 20
---

# ADR-036: npm 公開を tag 起点の Trusted Publishing + Staged Publishing に一本化する

## Status

Accepted

## Context

commit 1116f86 は、npm 公開を手動の `workflow_dispatch`（`publish.yml`）に限定した。意図は、supply chain 経由の無断公開を防ぐことである。人間が dispatch を押すことが、公開前のゲートだった。

この経路には次の弱点があった。

- ゲートは「CI を起動する操作」であり、検証済み成果物との対応は保証されない。`publish.yml` は `validate` を経由せず、test も走らない。
- `pnpm install` と build が、`id-token: write` を持つ job の中で実行される。依存パッケージの lifecycle script が OIDC token を取得しうる。
- 公開は直接 `npm publish` であり、OIDC token を得られれば人間の承認なしに公開が完了する。

ADR 020 は `release.yml` による公開フローを提案したが、`NPM_TOKEN` を前提としていた。トークンを使わない現行の OIDC 公開とは前提が異なるため、公開経路についてはこの ADR が現行の判断である（ADR 020 のうち exports 整備と CI パイプラインの判断は有効）。

npm は staged publishing を提供している。CI は tarball を stage に載せるだけで、公開には maintainer による 2FA 承認が要る。trusted publisher 側で `--allow-stage-publish` だけを許可でき、直接 publish と分離できる。

- https://docs.npmjs.com/staged-publishing
- https://docs.npmjs.com/cli/v11/commands/npm-trust

## Decision

### D1: tag push を起点に、`release.yml` から自動で stage する

`release.yml` に `npm-stage` job を追加し、`validate` を通過した後に自動で stage する。`publish.yml` は削除し、公開経路を 1 本にする。人間ゲートは npm 側の 2FA 承認に移る。

### D2: 検証済み tarball を、特権を持たない job で作る

- `validate` job（`contents: read` のみ）が品質ゲートを通した後、tag と `packages/shiori-cli/package.json` の version の一致を検査し、`pnpm pack` で tarball を作って artifact として渡す。tarball の integrity はログに出力する。
- `npm-stage` job（`id-token: write`）は checkout も install も build も行わず、tarball を download して `npm stage publish ./<tarball>` するだけにする。
- tarball を指定した publish では lifecycle script が走らない（npm 11.20.0 のソース `lib/commands/publish.js` で確認。`spec.type === 'directory'` のときだけ実行される）。OIDC token が使える間に第三者コードが動く経路がなくなる。公開物は test を通した成果物そのものになる。

### D3: trusted publisher と GitHub environment の二重束縛

- npm 側: `release.yml` + environment `npm` に対して `--allow-stage-publish` だけを許可する（stage-only trust）。Publishing access は "Require two-factor authentication and disallow tokens" にする。
- GitHub 側: environment `npm` の deployment 対象を tag パターン `v*` に限定する。required reviewer は付けない。人間ゲートは npm の 2FA 承認に一本化する。
- tag の作成・更新・削除は tag ruleset で admin のみに制限する。

### D4: npm CLI の固定とプレリリース

- `npm install -g npm@11.20.0` の直後に `npm --version` を assert する。staged publishing は npm 11.15.0 以上が必要で、`lts/*` 同梱の npm では保証されないため。
- version に `-` を含む tag（例: `v0.3.0-rc.1`）は npm で `--tag next`、GitHub Release で `--prerelease` にする。latest を上書きしないため。

手順は `docs/releasing.md` に書く。この ADR は判断を、releasing.md は手順を担う。

### 却下した案

- **`workflow_dispatch` を残す**: 未検証の経路が 2 本目の公開経路になる。dispatch でも人間操作が 2 回に増える。workflow の修正が必要なときは patch tag で出し直す。
- **特権 job で再ビルドする**: 検証済み成果物と公開物の同一性が保証されず、install の lifecycle script が OIDC token と同じ job で動く。
- **`github-release` を `npm-stage` の後ろに直列化する**: GitHub Release は npm の approve と独立した成果物で、直列化しても approve 待ちとは同期しない。
- **tag の commit が master の祖先であることを検査する**: write 権限者は `release.yml` ごと改変できるため防御にならない。tag ruleset で代替する。
- **npm 本体の tarball integrity pin**: 受容リスクとして記録する（下記）。
- **Status を Proposed にする**: 判断自体は承認対象であり、未検証なのは実装の観測項目である。観測項目は Consequences に記録する。

## Consequences

### 受容したリスク

- `npm install -g npm@11.20.0` の integrity は pin しない。この job に install する依存はなく、取得するのは npm 本体だけ。11.20.0 は公開から 1 週間以上経過している。
- `github-release` と `npm-stage` は並列に走る。`npm-stage` だけ失敗すると、GitHub Release が先に出る。旧構成（別 workflow）と同じ性質である。
- trust は workflow ファイル名と environment に束縛されるが、ref の内容には束縛されない。write 権限者が改変した `release.yml` に tag を打つ経路は、tag ruleset と approve 前確認で止める。
- tag ruleset が未設定だと、D3 の environment 束縛だけでは workflow の改変を止められない。移行手順で ruleset を先に作る。
- `validate` job 内の依存コードによる tarball の改変は、approve 前確認（`npm stage view` / `npm stage download` と、validate ログの integrity の照合）で緩和する。tag 起点の自動 stage では、これが人間による唯一の内容確認になる。
- merge 後は旧経路での緊急公開ができない。公開は `release.yml` 経由のみになる。

### 初回の rc リハーサルで確認する項目

- `setup-node` の `registry-url` 設定の下で、`npm stage publish` が OIDC で認証される。
- approve 前は `npm view` に version が出ない。
- approve 後に `dist.attestations`（provenance）が付く。stage → approve 経路での付与は、一次資料でも実機でも未確認。付かなければこの ADR に追記し、`--provenance` の明示を検討する。
- `npm stage view` の integrity が、validate job の "Print tarball integrity" と一致する。
- rc tag の GitHub Release が prerelease として作られる。

### 運用

- 人間側の移行手順（environment 作成、tag ruleset、trust 追加）を merge 前に済ませないと、次回の `npm-stage` は OIDC 拒否で失敗する。安全側の失敗で、復旧は re-run で足りる。
- 旧 `publish.yml` 用の trust が残る間は、直接 publish の経路が生きている。リハーサル成功後に速やかに revoke する。
- 具体的な手順は `docs/releasing.md` を参照する。
