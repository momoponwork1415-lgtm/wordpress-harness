# Knowledge: reference harness comparison

Status: official-source comparison; Anthropicの情報設計・評価比較は2026-09-15に更新。他資料は2026-09-10の確認。

## Conclusion

外部Harnessは、入力の出典、証拠の独立性、失敗の記録、権限の境界を比較する材料になる。file数、Promptの長さ、pipeline段数から診断品質は推定できない。

このnoteは外部根拠と推論だけを記録する。採用方針は[Research Design](../RESEARCH-DESIGN.md)、構成は[Architecture](../ARCHITECTURE.md)、現在の実装状態・source path・Behavior Testは[Codebase Guide](../CODEBASE-GUIDE.md)、次の有限workはGitHub Issuesを正本とする。

## Evidence boundary

「Observed」は固定commitのsource / docsまたは提供者の公式記事から確認した事実、「Inference」はこのrepositoryへの判断である。記事だけから非公開schema、recovery、性能またはWordPress recallを推定しない。

| Reference | Verified source | Limit |
| --- | --- | --- |
| wp2shell / CDC | [wp2shell exact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)、[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf) | 肯定解とRCE goalを持つ実験。oracle-free prospective recallを直接示さない。 |
| OpenAI Codex Security | [`c8296885f`](https://github.com/openai/codex-security/tree/c8296885fbbf593edc1b405dc49859496b2bd8e4) | 公開SDK / pluginの構造。WordPressでの性能を示さない。 |
| Anthropic Defending Code Reference Harness | [`d3bea6b57`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) | 保守終了済み。autonomous harnessはC/C++ memory safety向け。interactiveなsource review資料もある。 |
| Google / Mandiant AVDH | [公式記事](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) | 内部architectureの説明。公開codeやdurability testはない。 |
| Cloudflare VDH / VVS | [Harness記事](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)、[VDR記事](https://blog.cloudflare.com/vulnerability-discovery-remediation/) | 内部運用の説明。非公開implementationは検証できない。 |
| Aikido known-CVE benchmark | [2026-08-21 benchmark](https://www.aikido.dev/blog/ai-model-benchmarks-aug-21-2026) | 固定したAikido Harness内で探索modelだけを比較。dataset、target revision、prompt、tool、判定記録は非公開で、Harness間比較ではない。 |
| Wordfence PRISM / Argus | [PRISM profile](https://www.wordfence.com/threat-intel/vulnerabilities/researchers/prism)、[breadth / depth記事](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/) | WordPressでの発見例と運用方針。prompt、model、実装、missを含むrecall datasetは非公開。 |
| Unit 42 NOVA | [公式記事](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/) | 内部Harnessの集計と14-project model比較。公開source、target一覧、candidate判定記録はない。 |

## What each method treats as the frontier

| Method | Frontier | Who decides the next move | What completion means |
| --- | --- | --- | --- |
| Static / dataflow | query authorが定義したsource、sink、flow model内のpath。[CodeQL path query](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) | query / model author | 選択queryが抽出model内を完走。未知semantic bugの不在ではない。 |
| Coverage-guided fuzzing | concrete input corpusと新しいruntime edge / state。[AFL++ approach](https://aflplus.plus/docs/afl-fuzz_approach/) | fuzzerがmutation、人がharness / oracle / Budget | crashやcoverage停滞。business-logic bugには別oracleが必要。 |
| Manual semantic research | security assumption、workflow、state transitionに対する更新中の仮説。[OWASP business logic testing](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/10-Business_Logic_Testing/00-Introduction_to_Business_Logic/) | researcher | 具体的な次手がなくなるまで。機械的closure proofはない。 |
| Agent-led semantic research | modelがsourceから作る仮説、counterevidence、remaining question | root agent / native subagent | AIがactionable frontierなしと判断し、Harnessがfailureやpending Validationがないことを確認。 |

**Inference:** agentic Harnessはstatic analysisやfuzzerを単にLLMへ置換したものではない。manual researcherが頭の中で持つfrontierをagent conversation、packet、cellまたはdurable artifactへ移す。どの表現を選んでも「全fileを触れた」「全cellが一度空になった」「runをunionした」は未知のbroken security semanticsを尽くした証明にならない。

## wp2shell / CDC: evidence limits

**Observed:** [wp2shellの公開記録](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)は、脆弱性の存在とRCEへの到達を前提にした一つの成功例である。最新WordPressのsourceと依存sourceを用意し、途中で人間が実効性を確認して追加の目標を与えている。最初のPromptだけで最後まで無人だったわけではない。公開された約10時間 / 約USD 25には、複数Target、negative control、miss、run varianceの比較がない。

**Inference:** 研究判断をagentが持つ構成と、人間の関与・検証証拠を分けて評価する必要がある。Promptだけではauthority、source integrity、durabilityを保証しない。wp2shell / CDCからの採用内容と適応理由は[Design lineage](../RESEARCH-DESIGN.md#design-lineage)を正本とし、ここへ複製しない。

## Public agentic harnesses

以下の「示唆」は設計比較からの推論であり、採用決定ではない。

| Reference | 公開されている証拠・責任分担 | 示唆と限界 |
| --- | --- | --- |
| Anthropic | runtime harnessとinteractive source reviewが併存する。[README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md#contents) | repository全体を単一方式として評価しない。詳細比較は次節。 |
| Codex Security | 調査packetとfresh local-source Validationを分け、coverageはauthorized inventoryとの対応で記録する。[Core scan](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/core-scan.md#L7-L39) | packet、Finding、Coverageの責任を区別できる。WordPressでの性能証拠ではない。 |
| Mandiant AVDH | 複数agentのValidationとSynthesis後、人間がdynamic evidenceを確認する。[Architecture and validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation) | file / entry-point coverageとsemantic validityは別。記事の段階構成をそのままpublic Interfaceにしない。 |
| Cloudflare VDH / VVS | original code上の実効性確認、別model review、freshなproduction contextの確認を説明する。[Validation](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust)、[Contextual judgment](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#contextual-judgment) | 検証の独立性と現在の適用可能性を分ける。独自のcoverage cellは未知問題の不存在証明ではない。 |
| Wordfence PRISM / Argus | 広い調査と長いchainの調査を区別し、Avadaの6-step chainは隔離環境で人間が確認した。[Breadth / depth](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/#breadth-and-depth) | 異なる複雑さの事例を評価する参考になる。二つのproduction engineを作る根拠やrecall比較ではない。 |
| Unit 42 NOVA | clean environmentでのreplayと反証確認を使う。14 projectsの比較ではmodelごとに異なるFindingも報告した。[Harness and comparison](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/#how-the-autonomous-research-harness-works) | model間の差を示す観測であり、known-CVE recallや特定の段階構成の因果効果を示さない。 |

## Anthropic: information design and evidence quality

### 比較範囲と限界

参照revisionは[`d3bea6b5793b5f3d59a75ebe69a58efa88383145`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145)。READMEとdocs一覧から本件に関係する資料を選び、入力・artifactの小さなsourceで補った。対象全体の実行や性能検証はしていない。

| 読む目的 | 一次資料 |
| --- | --- |
| 入口、用途、変更箇所の案内 | [README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md)、[Harness README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/README.md)、[Customizing](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/customizing.md) |
| 入力とcontextの責任 | [Prompting](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/prompting.md)、[Threat model](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/threat-model.md)、[System prompt construction](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/system_prompt.py)、[Target config](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/config.py) |
| 証拠、独立性、失敗 | [Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md)、[Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md)、[Data contracts](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/artifacts.py)、[Triage](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/triage.md) |
| 実行境界と権限 | [Security](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/security.md)、[Agent sandbox](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/agent-sandbox.md) |

[README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md#contents)は、保守終了したreference implementationであり、autonomous harnessはC/C++のmemory safety向けだと明示する。資料にはinteractiveなsource reviewもあるため、repository全体をruntime方式一つとして扱わない。以下は設計比較であり、WordPressでのrecallや他modelでの効果を示す実測ではない。

### 情報設計とSSoTへの示唆

| 観察 | このrepositoryで検討すること |
| --- | --- |
| [Harness README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/README.md)はdemoの入口、[Customizing](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/customizing.md#where-the-cc-specifics-live-concretely)は変更箇所の案内として目的を示す。ただしREADMEとPipelineには手順・段階説明の重複もある。 | **提案:** docを読む人の質問から入口を分ける。外部repoのfile分割自体をSSoTの模範とはしない。変更箇所・Interface・Behavior Testの正本は既存の[Codebase Guide](../CODEBASE-GUIDE.md)を使う。 |
| [System prompt construction](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/system_prompt.py#L37-L85)はcontextを一度解決し、その同じ値を出典表示とagent入力へ渡す。固定の環境説明と利用者のcontextも分ける。 | **提案:** 重複点検では「同じ情報が二度見えるか」より「同じ事実を二箇所で編集するか」を調べる。JSONと文章の併存だけでは不具合と断定せず、正本・派生表示・更新責任・不一致時の扱いを確認する。 |
| [Prompting](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/prompting.md#share-existing-mitigations)はsourceだけでは分からない環境上の防御をcontextとして扱う。[Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#before-you-scan-map-scope-equip)は資料を全て直接投入する代わりに参照手段を用意する。 | **提案:** repositoryの開発案内、実行入力、外部資料の役割を区別する。必要な事実を消して短縮する前に、その出典と参照権限を確かめる。外部資料の推奨を現在のPrompt変更の承認とは扱わない。 |

### 評価・検証・権限の比較

「一致」は[Research Design](../RESEARCH-DESIGN.md)と[repository rules](../../AGENTS.md)に既にある方針との一致を指す。実装完了の意味ではない。現在の実装状態は[Codebase Guide](../CODEBASE-GUIDE.md)を参照する。

| 観点 | 一次資料の要点 | このrepositoryとの関係 |
| --- | --- | --- |
| 証拠品質 | [Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#verification-the-load-bearing-component)は説明だけでなく観測可能な証拠を重視する。 | **一致:** source上の成立、runtime確認、人間の確認を区別する。**不一致:** runtime証明をsource Findingの成立条件へ戻さない。 |
| 独立性 | [Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#what-each-stage-does)はfreshな検証環境と限定したhandoffを説明する。 | **一致:** ResearchのconversationやscratchをIndependent Validationへ引き継がない。**不一致:** class別graderや繰り返し採点をsingle fresh source-only Validationの代わりにしない。 |
| 失敗 | [Data contracts](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/artifacts.py#L135-L174)は不検出、棄却、agent/build failureを別statusにする。[Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#watching-a-run)は失敗・中断時もtranscriptを残す。 | **一致:** failureをnegativeへ丸めず、既存証拠を保持する。**境界:** 外部資料の自動retry方針は、人間のGrant reviewやValidation Retryの権限を置き換えない。 |
| 隔離 | [Security](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/security.md#why-the-sandbox-is-necessary)はPrompt上の禁止だけでは能力制限にならないとする。 | **一致:** filesystem、network、credential、toolの制限を実行境界で保証する。**不一致:** 外部repoのsandbox opt-outやsource reviewへの弱い隔離を取り込まない。 |
| 人間の権限 | [Triage](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/triage.md#run-it)は人間にtrust boundaryと判断基準を確認する。[Security](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/security.md#rules-for-running-autonomous-agents)は外部へのwrite権限を制限する。 | **一致:** 人間がscopeと権限を決める。**境界:** 現repoのCandidate admission、exact Draft revisionとdestinationへの承認、最後のSubmitは独自の必須gateとして保つ。 |

## Known-CVE recall evidence

**Observed:** Aikidoはrecent CVE 32件を10 modelへ各3回、fresh session、最大30 turns、internetなしで実行し、case、prompt、tools、evaluation policyを固定した。[2026-08-21 benchmark](https://www.aikido.dev/blog/ai-model-benchmarks-aug-21-2026)。DeepSeek V4 Proは一回目17 / 32から3-run union 28 / 32へ増えた。Grok 4.6はunion 26 / 32、3回すべてで見つけたconsistent resultが21 / 32、GLM 5.3はunion 25 / 32、consistent resultが18 / 32だった。反面、DeepSeek Proのreported candidate中false leadは34.4%、Solは3.3%で、union recallと後段負荷にtrade-offがあった。

**Limit:** これはmodel比較であり、Mandiant、Cloudflare、Wordfence、NOVA、Anthropic Harness、Codex Securityの比較ではない。8月版はtarget、revision、prompt、tool、candidate判定を公開せず、既知箇所をagentへ与えたかも不明である。公開dataset、patched negative、secure repoがないため、full-repository navigation、prospective recall、false-positive率は再現できない。

**Inference:** single-run、union、再現率、Validation rejectionは異なる評価量である。この記事はmodel間・run間の差を示すが、長いturn数や特定の構成の因果効果を示していない。

## Comparison proposals and policy boundaries

下表は参考案であり、implementation planや優先順位の正本ではない。採用には[Change gate](../RESEARCH-DESIGN.md#change-gate)と個別Issueを使う。

| 参考案 | 根拠と既採用方針との境界 |
| --- | --- |
| 正本・派生表示・更新責任を区別してdocと入力の重複を点検する。 | Anthropicのcontext出典一貫性が参考になる。JSONと文章の併存だけで不具合と断定せず、独立した編集点があるかを確認する。 |
| 評価の記録で、固定条件、確認段階、判断不能の理由を識別できるようにする。 | Aikido / NOVAの限界を踏まえ、model比較とHarness比較、既知positiveとprospective evidenceを混同しない。具体的な評価caseと受入条件はIssueへ置く。 |
| 提出判断では過去のFindingと最新配布版への適用可能性を分ける。 | Cloudflareの[latest source確認](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#contextual-judgment)が参考になる。WordPressではGit mainとofficial配布packageを同一視しない。再確認結果で元のFindingを削除せず、Researchのoracleへ戻さない。 |
| 観測できる証拠を増やす時も、source成立・runtime確認・人間の判断を分ける。 | 各資料は検証を重視するが、runtimeをsource Finding成立の必須条件にする根拠にはならない。既採用の責任分担は[Independent Validation](../RESEARCH-DESIGN.md#independent-validation)を参照する。 |

外部資料のpositive oracle、既知脆弱性情報、固定partition、投票、class別grader、自動retry、sandbox opt-outは個別の前提を持つ。現repoのoracle-free、source-only、single fresh Validation、人間の承認、no-silent-fallbackを置き換える提案ではない。研究手法とresource ceilingの正本は[Research Design](../RESEARCH-DESIGN.md)、実行境界は[repository rules](../../AGENTS.md)にある。
