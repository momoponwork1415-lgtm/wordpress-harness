# Research Design

Status: accepted research policy, 2026-09-10

## Goal

既知脆弱性のoracleなしに、high-impactなbroken security semanticsを高recallで発見し、freshなIndependent ValidationからFindingを生成する。これが診断coreの成功条件である。runtime verification、Target Selection自動化、Human OSと外部提出支援は前後のsupporting workflowであり、Researchのpromotion条件にしない。

**Do not optimize for sinks. Optimize for broken security semantics.**

Researchが深く追うProgramme対象は、unauthenticatedまたはSubscriber / Customerから到達できるArbitrary PHP File Upload / Read / Deletion、Arbitrary Options Update、RCE、Authentication Bypass / Privilege Escalation to Administrator、Stored XSS、SQL Injection、およびProgramme上criticalなunauthorized data alteration / readである。active installation、WordPress.org掲載とpremium eligibilityはTarget Intelligenceがadmission時に判断し、Researchへ再計算させない。RCEは最上位impactだが、別の列挙impactをRCEまで伸ばす必要はない。

## Decision ownership

Harnessは判断内容ではなく、判断できる安全な条件と証拠を所有する。

| Concern | Harness owns | AI owns |
| --- | --- | --- |
| Target Selection | oracle-free Candidate Pool、source identity、freshness、Budget、人間のBatch承認 | 優先Target、理由、不確実性、再調査価値 |
| Research | Target / Dependency Snapshots、Prompt、Permission、Grant wall time、両Human Review、record、terminal semantics | 仮説、native subagent、読む順序、継続提案、停止提案、Candidate、parked Programme Lead |
| Source Validation | fresh独立runtime、source-only権限、candidate binding、Finding生成条件 | source上の明白な反証、proof gap、disposition提案 |
| Dynamic Reproduction / Human OS | fresh WordPress / MySQL runtime、Private Evidence、external authorization | bounded reproduction、実効性の判定、理解支援、Draft作成 |

固定のrank、diversity cap、reason code、worker role、Finder数、Wave、Lease、Depth、Approach Family、Validation RubricをAI判断の代わりにしない。schemaはidentity、authority、evidence、failure semanticsとcontext handoffに使う。

## Design lineage

Research designの出発点は、Wordfence Argusが公開した「**confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, and then iterate hard and fast**」という10動詞のapproachと、[wp2shellのexact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)、その元になったOpenAIの[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)である。[Argusの記事](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)は詳細を公開していないため、10動詞をこのrepositoryでは次のように具体化する。

| Principle | Repository interpretation |
| --- | --- |
| confine / constrain | gVisor、read-only source、Permission、Budget、versioned bindingで権限と実行境界を固定する |
| focus / motivate / prioritize | Target approval、Threat Context、Programme BoundaryとPromptで目的を明確にし、優先順位とoff-model FindingはAIに残す |
| parallelize / hypothesize | provider-native Root / subagentが独立したrouteと反証可能なsource-bound claimを作る |
| verify / record | 探索内のadversarial review、fresh Independent Validation、immutable Finding、append-only Receiptを分離する |
| iterate hard and fast | Rootがsynthesize、challenge、redirectを繰り返し、各Grantのhuman review後だけ同じCheckpointから次へ進む |

wp2shell promptの研究手法は[WordPress Plugin Research v2](../prompts/wordpress-plugin-research-v2.md)へすべて取り入れる。具体的にはfirst-principlesのraw-source analysis、native multi-agentの積極的で動的な利用、固定assignmentの禁止、genuinely diverseなportfolio、明示的なApproach Family Registry、収束時のunderexplored familyへのredirect、見込みだけで一routeを支配させないこと、blocked routeの新機構による再開、incompatible routeの複数round維持と遅いcross-pollination、concrete bugのadversarial double-check、Rootによる反復的なsynthesis / challenge / redirect / new round、first waveや現在のapproachの失敗だけで停止しないこと、dependency sourceを読んだmissing linkとintermediate bugのchain探索である。

持ち込まないのは、wp2shell task固有の「脆弱性が存在してpre-auth RCE / `/flag`へ必ず到達する」というpositive oracleと最低6時間の指定だけである。元のCDC promptの肯定解と最低8時間も同じ理由で持ち込まない。最大4体は現在のresource ceilingとして使い、Approach Family RegistryはRootのscratchに置く。dependencyのrun中cloneは事前pinしたread-only Dependency Snapshotへ置き換える。これらは研究要素の省略ではなく、prospective mission、再現性、isolation、Human Research Reviewへ適応した実行境界である。tempoはevidence、isolation、Human Research ReviewまたはCandidate admissionを省略する理由にしない。

Claude Code、Codex、Grok等が既に提供するmodel loop、context管理、session resume、native subagentの起動・message・wait、tool routingをHarness内で再実装しない。Provider Adapterは公式native機能を設定・制限し、Target / Prompt / Runtime / Permission / Budget bindingとReceiptへ変換する。安全上必要な最小read-only source seamやintegrity checkはHarnessが所有するが、provider-neutralなagent framework、conversation engine、schedulerまたはtool DSLは作らない。native機能が利用不能またはadmit不能ならsilent fallbackせず、typed `incomplete`として残す。

## Target Selection

Target Intelligenceはoracle-freeなSelection Factから、AIがResearch価値を比較してTarget Proposalを作る。利用規模、更新状況、integration、source scale、Programme Eligibility、Disclosure Route、Research Historyは判断材料にできるが、全候補のrank、固定Band、固定facetのdiversityまたは列挙済み理由を要求しない。

Harnessのhard gateは次に限定する。

- sourceを正規に取得できる。
- Plugin Identity、version、provenanceとCanonical File Manifestを固定できる。
- 実行直前のsourceとversionがfreshである。
- 選択結果が入力Candidate Poolへ含まれる。
- 人間がApproved Target BatchとしてResearch対象範囲を承認する。

Programme対象外、Disclosure Route不明、既探索またはAIの低評価だけを技術的Researchの拒否条件にしない。既探索Targetの再投入理由と重複active Campaignは記録するが、再調査価値はAIが判断する。

## Agent-led Research

通常運転はwp2shell / Cycle Double Cover Promptを直接の系譜とする、raw-source-firstの一つの連続loopである。Provider-native Root agentはTarget Snapshot全体を読み、pluginが依存するWordPress core等の挙動をpinned Dependency Snapshotから解決する。[WordPress Plugin Research v2](../prompts/wordpress-plugin-research-v2.md)に従ってnative subagentを積極的かつ動的に使い、互いに異なるroute、反証、synthesisまたは追加調査を進める。Dependencyはsource worldを完成させるreferenceであり、別のaudit Targetにしない。HarnessはRootを含む同時active agent最大4体のresource ceilingだけをprovider runtimeで強制し、agentの実数、role、round、探索classまたは読むfileを指定しない。Rootだけが最大3体のsubagentを起動し、役割、終了後の再投入とwaveを決める。探索評価ではGrokを先に使う。利用不能時に同じCampaignを暗黙fallbackせず、GLM 5.3等の別Runtime Profileをbindした新しいCampaignとして明示的に比較する。

一回のResearch Native RunをResearch Grantとし、wall-time allowanceは最大1時間とする。Research Rootのprovider-native conversationとscratchはprivate Agent Checkpointとして継続できる。Harnessは固定checkpoint cadenceや内部tool eventをdomain modelにせず、bindingとintegrityを持つopaque refだけを記録する。timeoutまたはprovider interruptionでもCheckpointを保存できなければ`incomplete`であり、resume可能とは扱わない。Independent ValidationへResearch Checkpointを渡さない。

判断は単純である。

```text
eligible impactへの具体的な次手がある -> continueを提案し、人間のGrant reviewを待つ
eligible Candidateがある              -> scratchへ記録し、探索内で敵対的に反証する
OOS primitiveだけがある               -> lightweight parked Programme Leadとして保存する
active frontierがない                 -> evidence-backed stopを提案
外部制約で続行できない                -> incomplete
```

AIが`continue`を返すとCampaignは`research-review-pending`で止まる。Human Research Continuation Reviewはexact input、run、Checkpoint、Candidate set、parked Programme Lead setとnext actionへbindし、`continue-research`だけが次のGrantを開始する。Candidateが存在する場合、人間は`proceed-to-candidate-review`で現在の探索を区切れる。人間の自由記述reasonはResearchへ渡さず、source-bound next actionだけを渡す。

一つのCandidateを得ただけで停止せず、Rootはactive routeに限ってnative subagentによる敵対的レビュー、合成、リダイレクトを行う。Programme Boundary上で現在の最大source-supported effectが対象外で、eligible impactへの具体的なedgeがないprimitiveはParked Programme Leadとして最小限のevidenceを残す。Parked Leadをsubagentへ委譲せず、Candidate adversarial review、Human Candidate Review、Independent ValidationまたはFindingへ流さない。新しいsource evidenceがATO、Admin昇格、RCE等のeligible impactへ具体的に接続した時だけactive routeまたは新Candidateへ昇格する。RCEへ伸びないことだけを理由に重大なSQLiやStored XSSを未完成扱いしない。支持数、model confidence、到着順、static rule non-match、Surface Map外であることをCandidateの棄却またはsafe判定に使わない。

staticまたは派生解析の出力があってもnavigationとevidenceの補助に限り、探索空間またはcompletion proofにしない。現行agent pathはraw sourceを直接読む。

## Independent Validation

Validation Candidateは、Target Snapshot、attacker premise、broken security property、主張と初期source anchorを持つ。固定rubric、順番付き完全route、vulnerability class、RCE escalationまたは特定mechanism Adapterへの対応をadmission条件にしない。

Researchを区切ってCandidateがあれば、Campaignは`candidate-review-pending`で止まる。Human Candidate Reviewはexact Candidate setへbindし、`advance-to-independent-validation`だけをValidationする。`return-to-research`が一件でもあれば全Validationより先にResearchへ戻し、`park-programme-oos`と`hold-scope-ambiguous`は記録するがValidationしない。

Independent Validationは人間がadvanceしたCandidateごとに一回のfresh source-only runを行う。Research Rootのconversation、scratch、verdictまたはProgramme Research Boundaryを共有せず、同じTarget / Dependency SnapshotsからValidator自身がreachability、attacker control、既存防御、security effectとcounterevidenceを再導出する。[Fresh Source Validation v1](../prompts/fresh-source-validation-v1.md)はsubmission-readyなexploitを要求せず、source上で実在するvulnerable pathかを判定する。最適payload、完全な抽出、runtime reproduction、最大severityまたはRCE昇格は後段のVerification事項であり、source上のtrue positiveを棄却する理由にしない。TargetまたはDependencyのcode、build、test、runtime attackを実行しない。provider、tool、sourceまたはoutput制約でrunが失敗または`validation-pending`になった時だけ、人間はexact current failed run集合へbindしたHuman Validation Retryを出せる。Retryは別のfresh attemptをappendし、失敗Receiptを削除せず、技術的結論が出たValidationを再実行しない。

複数Targetは互いに独立したCampaignとprocessとして並列実行する。Harness内へ中央schedulerやcross-Target Validation queueを作らず、providerまたはoperatorの既存process並列性を使う。

| Disposition | Meaning |
| --- | --- |
| `source-validated` | source evidenceから主張を独立に支持でき、Findingを生成する |
| `needs-research` | 具体的で調査可能なproof gapがあり、Rootが継続を判断する |
| `disproven` | 必要なpremise、route、controlまたはeffectがsource evidenceで反証された |
| `validation-pending` | Budget、provider、tool、sourceまたはoutput failureで判断できない |

Findingの存在とCampaign completionは独立する。Independent Validationは軽いsource sanity gateであり、submission-readyなtrue positiveの最終判定器ではない。`source-validated` FindingはHuman OSのfresh Dynamic Reproductionへ渡し、実WordPress / MySQL上でFinding-bound Recipeを一度だけreplayする。`runtime-confirmed`は動的に実効性が確認されたことを示す。`disproved`は実行時反証をappendするが元Findingを削除せず、環境、依存条件、手順またはBudgetの不足は`incomplete`としてnegativeと区別する。別fresh environmentでのhuman verificationも同じくassuranceを追記する。

## Completion and failure

AIが有望なsource-bound next actionを残さず、全Validationがterminalで、Harnessが固定入力、source integrityとterminal outputを検査できた時だけCampaignを`coverage-closed`にする。これは脆弱性が存在しない証明ではなく、固定条件内でactionable frontierがなくなったという記録である。

具体的な次手を残したままCampaignのrun数またはwall timeへ達した場合、provider / tool / source / permission / schema / storage failure、またはpending Validationがある場合は`incomplete`とする。Providerが報告する推定costはReceiptへ保存するがHarnessの停止条件にしない。Finding 0、agentの一回のno-finding、timeout、Map coverageまたはtool hit数をclosureへ読み替えない。Findingが存在してもResearch workが残れば`incomplete`になり得る。

## Trust and versioning

- Target sourceをhost上で実行しない。
- Target / Dependency Snapshotsはread-only、隔離scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを適用する。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを与えない。
- gVisor相当以上のOS-level sandboxとTransport Eligibility capability probeを通らないruntimeを使わず、host processまたはplain Dockerへfallbackしない。
- Target / Dependency Snapshots、Prompt Set、Agent Runtime Profile、Permission Profile、Budget Envelope、outputをCampaignへdigest bindする。
- providerまたはmodelをsilent fallbackしない。GrokからGLM 5.3へ切り替える場合も別Runtime Profileと新しいCampaign inputを使う。
- 人間の必須gateはApproved Target Batch、各Research Grantの継続、CandidateのIndependent Validation admission、External Action Authorizationと最後のSubmitに置く。

Prompt、runtime、permissionまたはresearch policyの変更は進行中Campaignへ適用せず、新しいversioned Campaignで比較する。現行binaryへlegacy reader、feature flagまたは未使用Adapterを残さない。

## Change gate

変更は次を説明できる場合だけ採用する。

- public known-positive corpusでcandidateとsource-validated Findingのstage別recoveryを悪化させないか。
- prospective Campaignでhigh-impact recallを悪化させないか。
- Rootとsubagentのpermission継承を実測したか。
- DiscoveryとIndependent Validationのfreshnessを保てるか。
- source、provider、budgetまたはschema failureをnegativeへ丸めないか。
- public Interfaceからbehaviorを観測でき、旧内部Testを削除できるか。

診断coreの合否は既知positiveのoracle-free再発見とIndependent Validation成立で測る。patched版やbare controlは必要な比較実験でだけ使い、通常の診断またはpromotionに要求しない。隔離方式、Target Selection、Human OS、Coverage closureまたはLOCを診断精度の代理指標にしない。既存隔離は安全用Adapterとして再利用するが、実CVEの発見・検証を改善しない高度化へ先行投資しない。

Costは観測するがhard ceilingにしない。Cost削減はrecall baseline確立後に一変数ずつablationする。LOCは設計の証明または目標値にしない。未使用code、二つ目の実装がない汎用abstraction、AI判断を再実装するorchestrationを残さず、実測LOCの増加はpublic behaviorで説明する。

## References

- [ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)
- [ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)
- [ADR 0128](adr/0128-provide-pinned-dependency-source-to-research.md)
- [ADR 0131](adr/0131-place-human-reviews-between-research-and-validation.md)
- [ADR 0132](adr/0132-treat-provider-cost-as-observational-telemetry.md)
- [wp2shell exact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)
- [Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)
- [Reference harness comparison](knowledge/reference-harness-observability.md)
