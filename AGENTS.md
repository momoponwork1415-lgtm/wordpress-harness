# Repository development rules

このファイルはrepository全体の安定した開発規則だけを置く。subtree固有の規則が必要になるまでnested `AGENTS.md`を作らない。

## Mission

- Productの到達点は、oracle-freeなprospective Campaignで**high-impactなbroken security semanticsを高recallで発見し、独立ValidationからFindingを作り、fresh runtime verificationと人間の提出判断まで閉じること**。Finding生成を人間専用gateにせず、外部提出だけを人間の明示承認で許可する。
- RCEやsite-wide compromiseは最上位impactだが唯一の成功条件ではない。
- 通常運転はClaude Code Rootと必要に応じたnative subagentによるraw-source-firstの連続Research loop。source-boundで具体的な次手があればAIが継続し、有望なactionable frontierがなければ根拠付きで停止する。
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
- Target Intelligenceはoracle-freeな事実からAIがTarget Proposalを作る。固定rank、diversity cap、Research Value Bandまたはreason codeを要求しない。人間がApproved Target Batchを作るまでResearchへdispatchせず、実行直前にversionとsourceのfreshnessを再確認する。
- Researchのexternal seamは`conduct`と`inspect`だけを持つdeepなResearch Campaigns Moduleに置き、Agent-led Research、Independent Validation、Finding、Coverage、BudgetとResearch Recordを隠す。
- Native Agent Runtimeはprovider/process/session/tool bindingとreceiptを所有するが研究判断を所有しない。最初のproduction AdapterはClaude Codeとし、二つ目の実在runtimeを採用するまで汎用provider DSLを作らない。
- Root AIはnative subagent、仮説、読む順序、synthesis、critique、candidate、継続と停止を所有する。HarnessはFinder数、role、Wave、Lease、Depth、Approach Familyまたは固定手順を実装しない。
- Surface Map、PHP Program Index、AST、Semgrep、CodeQLは補助toolであり探索空間ではない。
- ResearchのValidationはcandidateごとに一つのfreshなsource-only runを行う。固定rubricまたはclass別Adapterを要求せず、Research Root自身ではなくIndependent Validationだけがsource-validated Findingを生成できる。
- Human OSはFindingをfreshな隔離環境でAI Reproductionし、runtime / human Verification Recordをappend-onlyに追加する。runtime失敗や人間の反証はFindingを削除せず、disprovedまたは理由付きincompleteとして残す。
- AIは脆弱性の理解とSubmission Draft作成を支援できるが、External Action Authorization、Draft承認、最後のSubmitを代行しない。
- SQLi、XSS等のclassはReproduction Recipeのsuccess criterionを助けるが、固定Adapterへの対応をcandidate admissionの条件にしない。

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
- Target/Prompt/Runtime/Permission/Budget binding、Rootとnative subagentの権限制約、single fresh Validation、Independent ValidationだけがFindingを生成すること、FindingとCoverageの分離、AI failureを棄却へ丸めないこと、external actionのhuman gateは回帰対象とする。旧schema、legacy replay、固定role orchestrationまたは未使用Adapterを新binaryへ残さない。

## TypeScript and PHP

- TypeScriptは`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を維持する。
- `any`やunchecked assertionをvalidationの代用にしない。versioned discriminated unionとruntime schemaを使う。
- PHP helperはpinned `nikic/PHP-Parser`に限定し、Campaign stateを所有させない。
- source analysisのためにtarget PHP、autoload、Composer script、WordPress bootstrapをhost上で実行しない。

## Security and evidence

- Target sourceはuntrusted dataとして扱う。host上でtarget package scriptを実行しない。
- Agentへprovider credential、container socket、ambient MCP、任意network、任意shellを渡さない。
- Research Rootとnative subagentはread-only Target Snapshotと隔離scratchを使い、runtime attackを行わない。
- Agent SandboxはgVisor相当以上のisolation backendを要求し、利用不能時にhost processまたはplain Dockerへsilent fallbackしない。
- Research ValidationはTarget sourceのread-only toolだけを使い、target code、build、testまたはruntime attackを実行しない。
- AI ReproductionとHuman Verificationは互いに異なるfreshな使い捨て隔離環境と実Target interfaceを使い、host上でtarget codeを実行しない。gVisor利用時にplain Dockerへsilent fallbackしない。
- Research Root、static ruleまたはself-reviewだけでFindingを生成しない。FindingはfreshなIndependent Validationとsource evidenceを要求し、runtime / human verification levelを明示する。外部行動はexact Draft revisionとdestinationへbindしたExternal Action Authorizationを要求する。
- exact payload、HTTP request、screenshot、runtime logはHuman OSのPrivate Evidence Bundleへ置く。credential、private target、transcript、PoC、未公開FindingをGitへcommitしない。
- RCEの証明はdisposable Lab内のnonce付きExecution Canaryに限定し、reverse shell、persistence、host access、許可外egressを使わない。
- external report、vendor連絡、公開artifactの送信は明示的なuser authorizationなしに行わない。
