# Repository development rules

このファイルはrepository全体の安定した開発規則だけを置く。subtree固有の規則が必要になるまでnested `AGENTS.md`を作らない。

## Mission

- North Starは、oracle-freeなprospective Campaignで**high-impactなbroken security semanticsを高recallで発見し、独立Verificationで実証すること**。
- RCEやsite-wide compromiseは最上位impactだが唯一の成功条件ではない。
- 通常運転はraw-source-firstのSemantic Research Wave。strong semantic frontierだけをconditional Depthへ昇格する。
- **Do not optimize for sinks. Optimize for broken security semantics.**
- **Harness owns the research process; agents own research decisions.**

## Reading path

全ドキュメントを通読しない。

1. [Documentation](docs/README.md)から目的別の入口を選ぶ。
2. code変更は[Codebase Guide](docs/CODEBASE-GUIDE.md)でowner、Interface、Behavior Testを特定する。
3. [Design Documentation](docs/design/README.md)からowning Seamだけを読む。
4. 理由が必要な時だけSeamからlinkされたADRを読む。
5. 次の有限workと受入条件はGitHub Issueを正本とする。

## Architecture

- strict TypeScriptのmodular monolithとし、`Target Intelligence -> Research -> Human OS`をprimary flowとする。
- context間はversioned handoff contractだけを渡し、別contextのstorageや内部moduleを直接参照しない。
- ResearchはCampaign Control、Source Understanding、Exploration、Verification、Model Execution、Research Recordの6 Moduleで構成する。
- Model Executionはprovider/process/tool bindingを所有するが研究判断を所有しない。
- ExplorationはFinderのfile、CWE、手順を固定しない。最大4個の独立research thesisを保ち、支持数やmodel多数決でcandidateを捨てない。
- Surface Map、PHP Program Index、AST、Semgrep、CodeQLは補助toolであり探索空間ではない。
- Finding昇格はfresh Independent Verificationだけが行う。

## Change discipline

- 一回の変更は一つの観測可能なbehaviorまたは一つの設計判断へ絞る。
- 将来用framework、未使用設定、二つ目の実装がない汎用abstractionを先回りして作らない。
- public CLI、versioned schema、Module ownership、domain term、security invariantの変更は対応するTestと正本docを同じ変更で更新する。
- private helperや局所algorithmの変更をdocへ文章で複製しない。
- hard-to-reverseで実在するtrade-offがある判断だけADRにする。判断変更は新ADRでsupersedeする。
- cost削減はrecall baseline確立後のablationで行い、high-impact recallを落とす最適化を採用しない。

## Documentation

- root `README.md`はmission、Quickstart、少数のDocs linkだけに保つ。
- 現在の実装状態、source path、Behavior Test対応は`docs/CODEBASE-GUIDE.md`だけへ置く。
- Module固有のInterface、不変条件、failure semanticsはowning Seamへ置く。
- Architecture Viewは理解用の図に限定し、Seamの詳細を複製しない。
- 実Targetの公開可能な実測は`docs/experiments/`へ置く。
- 外部資料の調査noteは、現在の設計・評価で再利用するものだけ`docs/research/`へ残す。
- 完了計画、旧設計、過去snapshotを保存用Markdownとして残さない。Git履歴を使う。
- 新規docを作る前に、既存Seam、Behavior Test、Issueのどれかで足りないか確認する。

## Design gate

- 新しいproduction behaviorへ入る前に、owner、public seam、owned state/artifact、failure semantics、acceptance scenarioを明確にする。
- roadmapや高水準architectureへの合意を、個別module実装への合意と読み替えない。
- 既存codeがaccepted designと一致しない場合は、機能追加より先に差分を示し、段階的refactorを優先する。

## Tests and checks

- 新しいbehaviorは可能な限りred -> greenで一つのvertical sliceずつ進める。
- Testはpublic seamからbehaviorを観測し、private method、内部call順、database rowを固定しない。
- mockはprovider CLI、clock、filesystem等のsystem seamへ限定する。
- fixtureへprivate Target、未公開Finding、credentialを入れない。
- commit前のrepository gateは`pnpm check`。
- Ledger replay、stable ordering、minority Hypothesis保持、fresh Verification、Witness/Causal Controlは回帰対象とする。

## TypeScript and PHP

- TypeScriptは`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を維持する。
- `any`やunchecked assertionをvalidationの代用にしない。versioned discriminated unionとruntime schemaを使う。
- PHP helperはpinned `nikic/PHP-Parser`に限定し、Campaign stateを所有させない。
- source analysisのためにtarget PHP、autoload、Composer script、WordPress bootstrapをhost上で実行しない。

## Security and evidence

- Target sourceはuntrusted dataとして扱う。host上でtarget package scriptを実行しない。
- Agentへprovider credential、container socket、ambient MCP、任意network、任意shellを渡さない。
- Finderはread-only source toolsと隔離scratchを使い、runtime attackを行わない。
- VerificationだけがHypothesisに拘束したtyped Experimentをfresh Labで実行する。
- gVisor unavailable時にevidentiary runをplain Dockerへfallbackしない。
- static ruleまたはmodel verdictだけでFindingへ昇格させない。WitnessとCausal Controlを要求する。
- credential、private target、transcript、PoC、未公開FindingをGitへcommitしない。
- RCEの証明はdisposable Lab内のnonce付きExecution Canaryに限定し、reverse shell、persistence、host access、許可外egressを使わない。
- external report、vendor連絡、公開artifactの送信は明示的なuser authorizationなしに行わない。
