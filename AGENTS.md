# Repository development rules

このファイルはrepository全体の安定した開発規則だけを置く。subtree固有の規則が必要になるまでnested `AGENTS.md`を作らない。

## Mission

- Productの到達点は、oracle-freeなprospective Campaignで**high-impactなbroken security semanticsを高recallで発見し、独立Validationで明らかなfalse positiveを抑え、Human Review PacketからHuman Verificationまで閉じること**。ResearchのNorth Starは発見からsource-only ValidationとReview Packet handoffまでを所有し、Human OSだけがFindingを昇格する。
- RCEやsite-wide compromiseは最上位impactだが唯一の成功条件ではない。
- 通常運転はraw-source-firstのSemantic Research Wave。strong semantic frontierだけをconditional Depthへ昇格する。
- **Do not optimize for sinks. Optimize for broken security semantics.**
- **Harness owns the research process; agents own research decisions.**

## Reading path

全ドキュメントを通読しない。

1. [Documentation](docs/README.md)から目的別の入口を選ぶ。
2. code変更は[Codebase Guide](docs/CODEBASE-GUIDE.md)でowner、Interface、Behavior Testを特定する。
3. 理由が必要な時だけ対応するADRを読む。
4. 次の有限workと受入条件はGitHub Issueを正本とする。

## Agent skills

### Issue tracker

IssueはGitHub Issues（`momoponwork1415-lgtm/wordpress-harness`）を正本とし、`gh` CLIで操作する。`docs/agents/issue-tracker.md`を参照する。

### Triage labels

`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`の5役割を既定の文字列のまま使う。`docs/agents/triage-labels.md`を参照する。

### Domain docs

`CONTEXT-MAP.md`が3 contextを宣言するmulti-context構成。`docs/agents/domain.md`を参照する。

## Architecture

- strict TypeScriptのmodular monolithとし、`Target Intelligence -> Research -> Human OS`をprimary flowとする。
- context間はversioned handoff contractだけを渡し、別contextのstorageや内部moduleを直接参照しない。
- ResearchはCampaign Control、Source Understanding、Exploration、Validation、Model Execution、Research Recordの6 Moduleで構成する。
- Model Executionはprovider/process/tool bindingを所有するが研究判断を所有しない。
- ExplorationはFinderのfile、CWE、手順を固定しない。最大4個の独立research thesisを保ち、支持数やmodel多数決でcandidateを捨てない。
- Surface Map、PHP Program Index、AST、Semgrep、CodeQLは補助toolであり探索空間ではない。
- ResearchのValidationはWave BarrierとRoot Evaluation後にfreshな複数Attemptとtool-free Synthesisで行い、Findingへ昇格させない。
- Finding昇格はHuman OSのfresh Human Verificationだけが行う。

## Change discipline

- 一回の変更は一つの観測可能なbehaviorまたは一つの設計判断へ絞る。
- 将来用framework、未使用設定、二つ目の実装がない汎用abstractionを先回りして作らない。
- public CLI、versioned schema、Module ownership、domain term、security invariantの変更は対応するTestと正本docを同じ変更で更新する。
- private helperや局所algorithmの変更をdocへ文章で複製しない。
- hard-to-reverseで実在するtrade-offがある判断だけADRにする。判断変更は新ADRでsupersedeする。
- cost削減はrecall baseline確立後のablationで行い、high-impact recallを落とす最適化を採用しない。Validationのbudget exhaustionをfalse positiveまたはrejectedへ読み替えない。

## Documentation

- root `README.md`はmission、Quickstart、少数のDocs linkだけに保つ。
- 結論を先に書く。短い文、箇条書き、比較表を優先し、同じ内容を文章と図で重ねない。
- 現在の実装状態、source path、Behavior Test対応は`docs/CODEBASE-GUIDE.md`だけへ置く。
- Module固有のSeamは`docs/CODEBASE-GUIDE.md`へPurpose、Interface、不変条件、failure semantics、Behavior Testの順でまとめる。
- Architecture Viewは理解用の図に限定し、Seamの詳細を複製しない。
- 実Targetの公開可能な実測と、現在の設計・評価で再利用する外部資料の調査noteは`docs/knowledge/`へ置き、通常のReading pathから外す。
- Knowledgeは設計の正本にせず、採用した結論をArchitecture、Research Design、Codebase Guide、ADRのいずれかへ残す。
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
- Ledger replay、stable ordering、minority Hypothesis保持、fresh Validation、条件付き第三Attempt、tool-free Synthesis、Human Verification ownershipは回帰対象とする。Witness/Causal Controlはlegacy replayとHuman Verification Assistantの回帰対象として残す。

## TypeScript and PHP

- TypeScriptは`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を維持する。
- `any`やunchecked assertionをvalidationの代用にしない。versioned discriminated unionとruntime schemaを使う。
- PHP helperはpinned `nikic/PHP-Parser`に限定し、Campaign stateを所有させない。
- source analysisのためにtarget PHP、autoload、Composer script、WordPress bootstrapをhost上で実行しない。

## Security and evidence

- Target sourceはuntrusted dataとして扱う。host上でtarget package scriptを実行しない。
- Agentへprovider credential、container socket、ambient MCP、任意network、任意shellを渡さない。
- Finderはread-only source toolsと隔離scratchを使い、runtime attackを行わない。
- Research ValidationはTarget sourceのread-only toolだけを使い、target code、build、testまたはruntime attackを実行しない。
- Human Verificationはfreshな使い捨て隔離環境と実Target interfaceを使い、host上でtarget codeを実行しない。gVisor Assistant利用時にplain Dockerへsilent fallbackしない。
- static ruleまたはmodel verdictだけでFindingへ昇格させない。Human Verificationの記録を要求する。WitnessとCausal Controlは人間が必要と判断したproof methodまたは任意Assistant evidenceとして使う。
- credential、private target、transcript、PoC、未公開FindingをGitへcommitしない。
- RCEの証明はdisposable Lab内のnonce付きExecution Canaryに限定し、reverse shell、persistence、host access、許可外egressを使わない。
- external report、vendor連絡、公開artifactの送信は明示的なuser authorizationなしに行わない。
