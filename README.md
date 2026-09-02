# WordPress Harness

WordPressプラグインのsource reviewを、LLMの探索力と独立した実証を組み合わせて反復するresearch harnessです。目指すのは、既知脆弱性のoracleなしにRCEまたは同等のsite-wide compromiseへ至る未知routeを発見・実証できる能力です。SQL injection、Stored XSS、account takeoverも独立した重要Findingおよび重大routeの構成要素として扱います。最上位の設計原則は、Wordfence Argusが示した10動詞です。

> confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, iterate

これらを標語や10段の固定pipelineではなく、所有module、永続artifact、実行時に観測できるgateを持つcontrol propertyとして実装します。Discoveryが作るものは未確認の`Hypothesis`であり、cleanな環境で独立Verificationを通過したものだけを`Finding`と呼びます。

旧`whitebox-harness`からcodeやcontractを移植せず、`wp2shell` promptの意図を小さなModuleとversioned artifactへ分解しています。Target source、prompt、provider output、payload、未公開FindingはGit外に置きます。現在の完成度は[Codebase Guide](docs/CODEBASE-GUIDE.md)、公開CVEでの実測は[experiments](docs/experiments/README.md)だけを正本とします。

## Start here

- [Documentation Guide — 文書の正本と読み方](docs/README.md)
- [Module Map — コードを読まずに機能関係を把握する](docs/design/architecture/module-map.md)
- [Harness Completeness Audit — 成功・不足・次の優先順位](docs/audits/harness-completeness-2026-09-03.md)
- [Codebase Guide — 現在のInterface・実装・Test・設計の対応](docs/CODEBASE-GUIDE.md)
- [Architecture overview diagram](docs/design/architecture/architecture-overview.md)
- [Development rules](AGENTS.md)

詳細が必要になったら、Codebase Guideから変更対象のSeamへ進みます。用語は[Context map](CONTEXT-MAP.md)、[Domain language](CONTEXT.md)、[日本語用語早見表](docs/JAPANESE-GLOSSARY.md)を正本とします。

## Design and research references

- [Architecture](docs/design/architecture.md)
- [Module architecture](docs/design/module-architecture.md)
- [Development harness](docs/design/development-harness.md)
- [Exploration seam](docs/design/exploration-seam.md)
- [Capability-first roadmap](docs/design/roadmap.md)
- [Design references](docs/REFERENCES.md)
- [Research synthesis](docs/research/agentic-source-review-ten-verbs.md)
- [AI-navigable codebase and development-harness research](docs/research/ai-navigable-codebase-specification-reference.md)
- [Codex Security development-harness reference](docs/research/codex-security-development-harness-reference.md)
- [daroo researcher reference](docs/research/daroo-researcher-reference.md)
- [White-box Surface Mapping security reference](docs/research/white-box-surface-mapping-security-reference.md)
- [Why the ten verbs are control properties](docs/adr/0001-ten-verbs-as-control-properties.md)

## Setup

```mermaid
flowchart LR
    map["Module Map"] --> status["Codebase Guide"]
    status --> setup["Install and check"]
    setup --> issue["One finite Issue"]
```

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

`vendor/`は生成物でありGitへ含めません。解析時にtargetのautoload、Composer script、WordPress bootstrapは実行しません。`campaign.json`のruntime schemaは[`contracts.ts`](src/research/contracts.ts)を正本とし、private artifactは`.private/`へ置きます。

## Scope

```mermaid
flowchart TB
    plugins["WordPress plugins"] --> research["Autonomous Research"]
    research --> findings["Verified Findings"]
    research -. "later context" .-> selection["Target Intelligence"]
    findings -. "outside Research" .-> external["Submission and vendor work"]
```

programme eligibility、報告書作成、vendor communication、patch生成はResearchの外側に置きます。能力の拡張順は[Capability-first roadmap](docs/design/roadmap.md)を参照してください。
