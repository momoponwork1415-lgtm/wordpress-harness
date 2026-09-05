# WordPress Harness

WordPressプラグインを対象に、Target選定、LLMの自由なsource reasoning、source Validation、AI Reproduction、人間のfresh Verification、提出準備をつなぐbug bounty research harnessです。Productの到達点は、既知脆弱性のoracleなしに**high-impactなbroken security semanticsを取りこぼさず発見し、明らかなfalse positiveを抑え、人間のfresh Verificationまで閉じること**です。

> **Do not optimize for sinks. Optimize for broken security semantics.**
>
> **Harness owns the research process; agents own research decisions.**

通常運転はraw-source-firstの有限`Semantic Research Wave`です。単独で重大なSQLi、Stored XSS、PrivEsc等はRoot Evaluation後のsource-only Validationへ進め、強いread/write/file/auth/state primitive、persistent state、cross-request flow、decode/reparse等の`strong semantic frontier`が残るTargetだけをDepth Admissionからwp2shell / Argus-likeなSynthesis・Critic・missing-link Waveへ昇格します。RCEやsite-wide compromiseは最上位impactですが、長いchainだけを成功とは定義しません。

Target Intelligenceがoracle-freeな事実から候補を自律選定し、人間がBatch承認したTargetを無人Campaign Queueへ渡します。ResearchはRuntime Verification Packetまで、Human OSはAI Reproduction、人間のfresh再実行、Finding、report承認、Submit直前のform stagingまでを所有します。

現段階ではtoken costやwall timeよりhigh-impact recallとroot-cause qualityを優先します。budgetはhard ceilingとして持ち、cost最適化はrecall baseline確立後にablationで行います。

## Quickstart

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

`vendor/`は生成物でありGitへ含めません。source analysisのためにtargetのautoload、Composer script、WordPress bootstrapをhost上で実行しません。private Target source、prompt、provider output、payload、未公開FindingはGit外へ置きます。

## Docs

- [Documentation index](docs/README.md) — 目的別の最短reading path
- [Research Design](docs/RESEARCH-DESIGN.md) — high-impact semantic recallとHarness/Agent境界
- [Harness Architecture](docs/ARCHITECTURE.md) — system context、Module、research loop、trust zones
- [Codebase Guide](docs/CODEBASE-GUIDE.md) — 現在の実装状態、Interface、Test、sourceの対応
- [Development Rules](AGENTS.md) — repositoryで作業するagent / contributor向け規則

判断理由は`docs/adr/`を参照します。公開CVEでの実測や外部実装の比較証拠は、通常の読み順から外した`docs/knowledge/`に置きます。

## Scope

現在のResearch対象はWordPress pluginsです。最初のproduct goalは、手動投入した最新TargetのProspective CampaignからHuman Verification済みFindingまでです。並行してTarget Intelligenceの自律選定、人間のBatch承認、無人Campaign Queueを作り、3 Target pilot後に多数Targetと約5 active Campaignへ広げます。初期Research modelはOpusだけを使い、multi-model化は実測後に判断します。Submissionは自動化せず、人間が承認済みreportを確認して最後のSubmitを行います。能力の拡張順は[Harness Architecture](docs/ARCHITECTURE.md)を参照してください。
