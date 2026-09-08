# WordPress Harness

WordPress pluginを対象に、AIによるTarget提案、agent-led source research、fresh Independent Validation、runtime / human verification、提出前の人間承認をつなぐresearch harnessです。

> **Do not optimize for sinks. Optimize for broken security semantics.**
>
> **Harness owns authority, evidence, isolation and limits; agents own research decisions.**

探索は一つの連続loopです。AIが具体的でsource-boundな次手を持つ間は続行し、有望なactionable frontierがなければ停止します。HarnessはFinder数、Wave、Depth、脆弱性class、読むfileまたは固定rubricを決めません。Unauthenticated SQLiやStored XSSはRCEへ伸ばさなくてもFinding候補です。

ResearchとIndependent Validationはnative agentをgVisor内で実行し、Target sourceはread-only、scratchだけをwriteableにします。入力、prompt、runtime、permission、budget、usage、failure、FindingとCoverageはdigest付きで永続化します。providerやmodelへsilent fallbackしません。

## Quickstart

```bash
pnpm install
pnpm check
pnpm build

node dist/cli.js campaign conduct \
  --database .private/research.sqlite \
  --input .private/campaign.json \
  --docker /usr/bin/docker \
  --image sha256:<immutable-image-id> \
  --source /absolute/path/to/read-only/source \
  --provider-config /absolute/path/to/provider-config \
  --scratch .private/scratch \
  --research-prompt .private/research-prompt.md \
  --validation-prompt .private/validation-prompt.md

node dist/cli.js campaign inspect \
  --database .private/research.sqlite \
  --campaign <campaign-id>
```

`campaign.json`のschemaとprompt digest helperは[`src/research/agent-led/contracts.ts`](src/research/agent-led/contracts.ts)にあります。runtimeはsealed `agentRuntimeProfile.kind`から選ばれます。探索試験ではGrokを優先し、利用不能時はCampaignを`incomplete`として残します。

private Target source、prompt、provider output、credential、payload、transcript、未公開FindingはGit外へ置きます。Targetのautoload、Composer script、WordPress bootstrapをhost上で実行しません。

## Docs

- [Documentation](docs/README.md) — 目的別の入口
- [Architecture](docs/ARCHITECTURE.md) — ownershipとhandoff
- [Research Design](docs/RESEARCH-DESIGN.md) — 探索・停止・Validationの原則
- [Codebase Guide](docs/CODEBASE-GUIDE.md) — 現在動く範囲、gap、source、Behavior Test
- [System Walkthrough](docs/SYSTEM-WALKTHROUGH.md) — 一件の流れ
- [Development Rules](AGENTS.md) — repository規則

旧v7へ戻す場合はtag `research-v7-before-native-agent-loop`と旧storageを組にして使います。新binaryは旧schemaを読みません。
