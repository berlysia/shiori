# リリース手順

`@berlysia/shiori` の npm 公開は、tag push を起点に `release.yml` が tarball を stage し、maintainer が 2FA で承認したときだけ公開される。判断の背景は [ADR-036](decisions/036-staged-npm-publishing.md) を参照。

## ローカルの前提

`npm trust` と `npm stage` は npm 11.15.0 以上が必要。手元の npm が古い場合は `npx npm@11.20.0 <command>` で実行する。

## 一度きりの移行

次の順序で行う。順序には理由がある。

### 1. environment と tag ruleset を作る

environment `npm` を作り、tag パターン `v*` だけを許可する。required reviewer は付けない。

```bash
gh api -X PUT repos/berlysia/shiori/environments/npm \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/berlysia/shiori/environments/npm/deployment-branch-policies \
  -f name='v*' -f type=tag
```

`v*` の tag の作成・更新・削除を admin のみに制限する ruleset を作る。`actor_id: 5` は repository admin ロールを指す。

```bash
echo '{"name":"release tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}' \
  | gh api -X POST repos/berlysia/shiori/rulesets --input -
```

### 2. npm trust を追加する（旧設定は残す）

```bash
npm trust github @berlysia/shiori --file release.yml --repo berlysia/shiori --env npm --allow-stage-publish
npm trust list @berlysia/shiori
```

`npm trust list` で旧設定（`publish.yml`）の id と条件を控えておく。

### 3. release.yml の変更を merge する

### 4. rc でリハーサルする

1. master 上で `pnpm run release --preid rc` を実行し、`0.2.2-rc.1` のような prerelease を選ぶ。bump の commit、tag `v0.2.2-rc.1`、push までが行われる。
2. Release workflow が成功したら、後述の「承認前の確認」を行い、approve して `next` として公開する。attestations は approve 後にしか確認できないため、rc も approve まで進める。

rc version は使い捨てにする。やり直すときは `rc.N` を進める。rc の bump commit は master に残り、本番の bump で上書きされる。approve した rc は `next` dist-tag に残る（仕様どおり）。

確認項目:

- stage が OIDC で認証される。
- approve 前は `npm view @berlysia/shiori versions` に version が出ない。
- approve 後に `npm view @berlysia/shiori@<version> dist.integrity` が validate job のログと一致する。
- `npm stage view` の integrity が validate job のログと一致する。
- GitHub Release が prerelease として作られる。

### 5. 速やかに旧設定を revoke する

リハーサルが成功したら、旧 trust を revoke し、npmjs.com の Publishing access を "Require two-factor authentication and disallow tokens" にする。旧設定が残る間は、直接 publish の経路が生きている。

```bash
npm trust revoke @berlysia/shiori --id <旧 publish.yml 設定の id>
```

revoke を最後にする理由は、先に revoke すると、リハーサルで問題が出ても PR の revert で旧経路に戻せなくなるため。

## 毎回のリリース

1. master 上で `pnpm run release` を実行する。品質チェックと build、test を通した後、[bumpp](https://github.com/antfu-collective/bumpp) が対話式で次の version を尋ね、`packages/shiori-cli/package.json` の書き換え、commit（`chore: release vX.Y.Z`）、tag `vX.Y.Z` の作成、push までを行う。bumpp は npm に publish しない。
   - prerelease は `pnpm run release --preid rc` で作る（例: `0.2.2-rc.1`）。
   - push された tag が Release workflow を起動する。tag は version から作られるので、validate の一致検査とずれない。
2. Release workflow の完了を待つ。`-` を含む version（例: `0.3.0-rc.1`）は `--tag next` で stage され、GitHub Release も prerelease になる。

### 承認前の確認

tag 起点の自動 stage では、これが人間による唯一の内容確認になる。

```bash
npm stage list @berlysia/shiori
npm stage view <id>
npm stage download <id>
```

次を確認する。

- version が tag と一致する。
- ファイル一覧に想定外のものがない。
- integrity が、validate job の "Print tarball integrity" のログ行と一致する。

### 承認

```bash
npm stage approve <id>
```

2FA を要求される。npmjs.com の画面から承認してもよい。

stage 直後は npm の自動レビュー（マルウェアスキャン）が終わるまで承認できず、`E409 ... can't be approved yet because automated review hasn't finished` が返る。数分待ってから再実行する。

### 事後確認

```bash
npm view @berlysia/shiori dist-tags
npm view @berlysia/shiori@<version> dist.integrity
```

provenance（`dist.attestations`）は、リポジトリが private の間は生成されない。public にした後は `npm view @berlysia/shiori@<version> dist.attestations` で付与を確認する。

## 失敗時の対応

- **npm-stage だけが失敗した**: `npm stage list @berlysia/shiori` で stage 済みでないことを確認してから、該当 run の失敗 job を re-run する。artifact の保持は 7 日で、過ぎると re-run できない。
- **workflow の修正が必要**: re-run は tag の commit の定義で動く。修正した workflow を使うには、patch version を上げて新しい tag で出し直す。GitHub Release は tag ごとに別物として残る。
- **誤って stage した**: `npm stage reject <id>`。
- **approve 後に誤公開が判明した**: `npm deprecate @berlysia/shiori@<version> "<理由>"`。
