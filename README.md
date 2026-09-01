# WordPress Harness

WordPressプラグインのsource reviewを、LLMの探索力と独立した実証を組み合わせて反復するresearch harnessです。目指すのは、既知脆弱性のoracleなしにRCEまたは同等のsite-wide compromiseへ至る未知routeを発見・実証できる能力です。SQL injection、Stored XSS、account takeoverも独立した重要Findingおよび重大routeの構成要素として扱います。最上位の設計原則は、Wordfence Argusが示した10動詞です。

> confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, iterate

これらを標語や10段の固定pipelineではなく、所有module、永続artifact、実行時に観測できるgateを持つcontrol propertyとして実装します。Discoveryが作るものは未確認の`Hypothesis`であり、cleanな環境で独立Verificationを通過したものだけを`Finding`と呼びます。

現在は再設計の初期段階です。解析対象として`custom-facebook-feed` 4.12.0と取得時のmetadataが置かれています。旧`whitebox-harness`からcodeやcontractを移植せず、まず最小の研究ループを確立します。旧repositoryの探索系譜は`wp2shell` promptに始まりますが、新しい設計判断の参照資料は保存した3記事に限定します。

## Start here

- [Module Map — コードを読まずに機能と現在地を把握する](docs/design/module-map.md)
- [Codebase Guide — 現在のInterface・実装・Test・設計の対応](docs/CODEBASE-GUIDE.md)
- [Architecture overview diagram](docs/design/architecture-overview.md)
- [Development rules](AGENTS.md)

詳細が必要になったら、Codebase Guideから変更対象のSeamへ進みます。用語は[Context map](CONTEXT-MAP.md)、[Domain language](CONTEXT.md)、[日本語用語早見表](docs/JAPANESE-GLOSSARY.md)を正本とします。

## Design and research references

- [Architecture](docs/design/architecture.md)
- [Module architecture](docs/design/module-architecture.md)
- [Proposed development harness](docs/design/development-harness.md)
- [Exploration seam](docs/design/exploration-seam.md)
- [Capability-first roadmap](docs/design/roadmap.md)
- [Design Baseline v0.1](docs/design/baseline-v0.1.md)
- [Design references](docs/REFERENCES.md)
- [Research synthesis](docs/research/agentic-source-review-ten-verbs.md)
- [AI-navigable codebase and development-harness research](docs/research/ai-navigable-codebase-specification-reference.md)
- [Codex Security development-harness reference](docs/research/codex-security-development-harness-reference.md)
- [daroo researcher reference](docs/research/daroo-researcher-reference.md)
- [Why the ten verbs are control properties](docs/adr/0001-ten-verbs-as-control-properties.md)

## Current implementation

Milestone 1では、versioned `campaign.prepared` event、single-writer SQLite Research Ledger、deterministic replay、crash-safe prepare retry、read-only inspect、薄いCLI adapterに加え、target PHPを実行しないcontent-addressed `PHP Program Index`を実装しています。Program Indexはsymbol、call、WordPress registration、guard、source、storage、sinkという構文上の事実だけを返し、脆弱性やtaintを判定しません。interfaceとtest対象は[Initial implementation seams](docs/design/initial-implementation-seams.md)と[PHP Program Index seam](docs/design/php-program-index-seam.md)に記録しています。

```bash
pnpm install
cd tools/php-program-index
composer install --no-dev --prefer-dist --no-interaction --no-scripts --no-plugins
cd ../..
pnpm check
pnpm build
mkdir -p .private
node dist/cli.js campaign prepare --database .private/research.sqlite --input campaign.json
node dist/cli.js campaign inspect --database .private/research.sqlite --campaign <campaign-id>
```

PHP helperはComposer lockで`nikic/php-parser` 5.8.0へ固定しています。`vendor/`は生成物でありGitへ含めません。解析時にtargetのautoload、Composer script、WordPress bootstrapは実行されません。

`campaign.json`は[`NewCampaignInput`](src/research/contracts.ts)に従い、CampaignId、Target Snapshot、policy、runtime、prompt、Model Profile、Knowledge Capsule、Experiment registry、budgetを固定します。`.private/`はGit対象外です。

## Initial scope

最初のvertical sliceは次だけを扱います。

1. plugin sourceとmetadataからWordPress固有の`Surface Map`を作る
2. 重複しない`Focus Area`を作り、探索workerへ割り当てる
3. falsifiableな`Hypothesis`を記録する
4. 別contextかつcleanなlocal WordPress環境で再導出・実証する
5. 結果と失敗から次の探索順を更新する

programme eligibility、報告書作成、vendor communication、patch生成は、DiscoveryとVerificationが実測で機能するまで対象外です。

最初のStored XSS vertical sliceは最終目標ではありません。browserによる安全な成立証拠（Witness）から研究loopを成立させ、private RCE Boundary Pair、prospectiveな重大脆弱性探索へ段階的に進みます。
