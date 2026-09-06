# Knowledge: reference harness comparison

Status: official-source comparison and first Prospective measurement, 2026-09-06

## Conclusion

参照Harnessと同じstage graphへ全面改築する根拠はない。採るべきものは工程名ではなく、次のcontrolである。

1. DiscoveryとIndependent Validationを分け、Finderに自己採点させない。
2. Finding、Coverage、実行状態を別artifactにし、停止時もFindingと未完了範囲を失わない。
3. target identity、source evidence、runtime evidence、外部行動承認を別々にbindする。
4. 並列探索は互いに異なるfocusを与える一方、whole-target wildcardを残す。
5. model外へdurable state、予算、retry、failure classificationを置く。
6. recallを推測値で主張せず、Prospective runの生存率、coverage growth、runtime成立率、人間負荷を測る。

これらは現行の`Target Intelligence -> Research -> Human OS`、Semantic Wave、conditional Depthを捨てなくても導入できる。現時点で最も強い独自部分は、vulnerability oracleをResearchから隔離するProspective評価、broken security semanticsを優先する探索、minority candidate保持、WordPress固有semanticsである。最も弱い独自部分は、実TargetをFindingまで完走する前に細分化されたartifactとcontrol planeである。

最初の実Target Prospective Campaignはsource Researchまで到達したが、Root Evaluation前にbudgetで`Incomplete`となった。したがってhigh-impact recall、false-positive率、runtime成立率、人間負荷は未実証であり、stage追加より先に一件を完走して比較可能なbaselineを作る必要がある。

## Evidence boundary

| Reference | Public evidence checked | What cannot be concluded |
| --- | --- | --- |
| Wordfence Argus | [Wordfence official article, 2026-08-27](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/) | 10個のcontrol verb、目的、model-agnostic方針以外のarchitecture、prompt、model、評価方法は非公開 |
| Anthropic | [`defending-code-reference-harness@d3bea6b`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) | 公開実装はC/C++ memory-safety中心であり、WordPress logic flawへの効果は直接示さない |
| OpenAI | [`codex-security@c829688`](https://github.com/openai/codex-security/tree/c8296885fbbf593edc1b405dc49859496b2bd8e4) | 汎用repository scannerのcontractであり、prospective target selectionや人間の外部提出判断は直接扱わない |
| Cloudflare | [Build your own vulnerability harness](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)、[Vulnerability Discovery and Remediation](https://blog.cloudflare.com/vulnerability-discovery-remediation/) | 内部Harnessのcodeとpromptは公開されておらず、記事の運用実績を再現検証できない |
| Google / Mandiant AVDH | [official architecture and evaluation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) | point-in-time内部architectureの説明であり、実装とbenchmark datasetは非公開 |
| Current harness | [Research Design](../RESEARCH-DESIGN.md)、[Architecture](../ARCHITECTURE.md)、[Codebase Guide](../CODEBASE-GUIDE.md) | 最初のProspective runがRoot Evaluation前に停止したため、発見能力の比較値はまだない |

以下では「Observed」を公開一次資料から確認できる事実、「Inference」をこのHarnessへ適用した場合の判断として分ける。

## What to adopt

| Practice | Observed | Inference for this harness | Primary gain | Decision |
| --- | --- | --- | --- | --- |
| DiscoveryとValidationの独立 | Anthropicはnoisy Discoveryとadversarial Verificationを分け、fresh sandboxにはPoCだけを渡す。Cloudflareも機械検査後に自分ではFindingを作れないisolated Validatorを置く（[Anthropic best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L45-L78)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust)）。 | Finderの自己抑制を避けながら、source根拠のない候補を人間へ送らずに済む。 | recall / validation quality | **Adopt now.** 現行single fresh Independent ValidationをFinding writerにする。 |
| Canonical FindingとCoverageの分離 | Codex Securityはimmutable `scan-manifest.json`、semantic `findings.json`、structured `coverage.json`を正本にし、`report.md`を再生成可能なprojectionにする。停止結果ではFindingとCoverageを保持し、Finding不在を結論にしない（[scan contract](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L1-L38)）。 | Findingの真偽と「どこまで探したか」を混同しなくなる。旧Packet変換も減らせる。 | maintainability / coverage honesty | **Adopt now.** schema全体はコピーせず、Finding、Verification Record、Coverage projectionだけを深いcontractにする。 |
| Semantic root identity | Codex Securityはline numberではなくrule family、semantic root-control anchor、independently attackable instanceからidentityを作り、曖昧なfingerprint一致を同一Findingの証明としない（[scan contract](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L70-L103)）。 | version更新や近接line移動を越えて、同じbroken controlと別instanceを追跡できる。 | maintainability / operations | **Adopt with the Finding contract.** 既存Causal Identityをroot-control中心へ単純化する。 |
| Persistence before parallelism | Cloudflareは各stageを`run_id, repo, stage`でSQLiteへ保存し、crash時はin-flight taskだけを失う構成にしている。Anthropicも段階artifactとterminal resultを逐次保存し、killed batchをresumeする（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#codifying-the-skill-into-a-pipeline)、[Anthropic pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L100-L115)）。 | 現行Ledger / CASは方向として正しい。ただしevent粒度を増やすより、各public stageのidempotent resumeを実測すべきである。 | operations / maintainability | **Keep, then simplify.** current writerとlegacy replayを分け、未使用eventを増やさない。 |
| Focused parallelism plus wildcard | AnthropicはReconで異なるsurfaceへ分割し、同じ浅いbugへの収束を抑えるが、単一fileには固定しない。複数runの結果はunionする（[best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L16-L36)、[iteration](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L114-L142)）。 | target-specific thesisで重複を減らし、wildcard thesisでReconの誤りとcross-surface chainを拾う現行policyは合理的である。 | high-impact recall / cost | **Keep and measure.** 最大4という数値自体は仮説なので、重複率とnet-new Findingで調整する。 |
| Threat context as evidence, not a cage | AVDHはExplorer / Specialist / SynthesisでThreat Modelを作り、人間確認後にentry-point分析へ進む。CloudflareはReconがrepo固有attack classを生成し、各Hunterにattackerとbroken boundaryの明示を要求する（[AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#threat-modeling)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#dynamic-threat-modeling)）。 | plugin固有のrole、capability、nonce、REST/AJAX/hooks、filesystem、deserialization、integration boundaryを短いartifactにすると高impact routeを見つけやすい。ただし誤ったMapをhard gateにするとrecallを落とす。 | high-impact recall / validation quality | **Adopt as a revisable input.** 人間承認を全Campaignの必須gateにせず、wildcard探索を残す。 |
| Honest Coverage and targeted gapfill | Codex Securityはreviewed surface、receipt、exclusion、deferred、completenessを分ける。Cloudflareは`area × attack-class` cellのcoverage growthとre-runのnet-new Findingをproxyとして追い、recall値は主張しない（[Codex contract](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L105-L163)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust)）。 | v6 Missing-link / Closureを接続する価値はあるが、固定CWE matrixを探索空間にしてはいけない。Gapは追加探索を選ぶ材料であり、安全判定ではない。 | coverage honesty / recall | **Finish the existing Closure first.** 新しいCoverage engineはpilot後に必要性を判断する。 |
| Fresh runtime proof and exact witness | Anthropicのgraderはfresh containerで元snapshotへPoCを再実行する。Cloudflareはuntouched sourceに対するworking PoCを要求する。AVDHもAI findingを人間がdynamic PoCで検証する（[Anthropic pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L55-L84)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust)、[AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#expert-validation)）。 | source-validなlogic flawと実interfaceで成立するimpactを区別できる。再現失敗もFindingを削除せず、`disproved / inconclusive / setup-blocked`を残す方が監査可能である。 | validation quality / operations | **Keep two assurance levels.** Researchでtargetを実行せず、Human OSのfresh gVisorだけでruntime evidenceを作る。 |
| Provider/model replaceability | Argusはmodel-agnosticでcapabilityとpriceを継続評価すると説明する。CloudflareはDiscoveryとVVSで異なるmodelを使い、provider volatilityをHarnessで吸収する（[Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#a-two-stage-vulnerability-research-workflow)）。Codex Securityは複数providerをCLIから選べる（[README](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/README.md#L79-L92)）。 | provider-neutral contractは保守性と相関誤りの検出に効くが、「別modelなら独立」という保証にはならない。 | validation quality / operations | **Keep the port; add a second adapter only with an eval.** frameworkだけを先に増やさない。 |
| Prospective evaluation | AVDHはmanually verified synthetic targetsを複数domainで反復し、人間がAI gradingも監査する。Cloudflareはvalidation funnelとheld-out repositoryでprompt変更を比較する（[AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#measuring-success)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#how-we-tell-its-working)）。 | 公開CVEだけではmemorizationを排除できない。known fixtures、oracle-free Prospective、held-out regressionを別目的で使うべきである。 | all five | **Adopt before architecture expansion.** 同一Target群で旧/新policyを比較する。 |
| Human gate on external action | Anthropicはopen-source report前に人間がreal releaseとreal interfaceで再現することを求める。CloudflareのFixerは自動mergeせず、人間がbranchをreviewする（[Anthropic best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L242-L260)、[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#automated-fixing)）。 | AIがsource-validated Findingを作ることと、外部のvendorへ送る権限は別である。 | safety / operations | **Keep.** exact Draft revisionとdestinationにbindした人間承認だけを外部行動gateにする。 |

## What not to copy

| Reference pattern | Observed | Why not copy it here |
| --- | --- | --- |
| Argusを10-stage pipelineと解釈する | 公開記事は`confine / constrain / focus / motivate / parallelize / hypothesize / verify / record / prioritize / iterate`をdesign approachとして列挙するだけで、内部architectureを開示していない（[Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)）。 | verbはacceptance checklistにはなるが、stage、agent、database schemaを推測する根拠にならない。 |
| Research中にtargetをbuild / executeする | Anthropicの公開pipelineはC/C++ targetをASAN buildし、Finderもgraderも実行する。agentはgVisorとAPI-only egressで隔離される（[pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L3-L11)）。 | WordPress package scriptやbootstrapをResearch hostで実行しない現行boundaryを弱める。Runtime proofはHuman OSのdisposable environmentへ置く。 |
| ASAN crash 3/3を全classのvalidation barにする | Anthropic pipelineのFinderはASAN crashを3/3で要求し、graderがfresh containerで再現する（[pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L44-L68)）。 | authz、CSRF、stored XSS、confused deputy、unsafe deserialization等のbroken semanticsには別のsuccess criterionが必要である。 |
| area × class cellを探索の入場条件にする | CloudflareはGapfillを`area × attack-class` cellで運用する（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#stage-1-vulnerability-discovery-harness-vdh)）。 | coverage帳簿には有効だが、未知のclass、複数component chain、minority routeを排除し得る。wildcard thesisの代替にしない。 |
| PoC不成立を即fake / deleteとする | Cloudflareはworking PoCのないFindingをfakeとして扱い、AVDHはhuman dynamic testingに失敗したFindingをdiscardすると説明する（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust)、[AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#expert-validation)）。 | setup failure、環境差、非決定性とsource contradictionを区別できない。Findingはimmutable observationとして残し、assurance stateを追記する。 |
| AVDHのwaterfallとconfidence filterをそのまま採る | AVDHは各phaseを順番に完了するwaterfallで、Hypothesis段階にconsultant設定のConfidence Filterを置く（[architecture](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#architecting-the-pipeline)、[hypothesis generation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation)）。 | early filterはlow-confidence / high-impact candidateをIndependent Validation前に落とす。現行minority保持と衝突する。 |
| 複数high-temperature Validatorを常に必須にする | AVDHは各Hypothesisへ複数のhigh-temperature Validation agentと一つのSynthesis agentを使う（[AVDH validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-validation)）。 | 相関誤りが減る可能性はあるが、costと精度の公開ablationはない。まずsingle fresh Validatorとruntime/human結果の相関を測る。 |
| Codex Securityの汎用product surfaceを移植する | Codex SecurityはCLI / SDK、bulk scan、findings service、exports、provider選択まで持つ（[README](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/README.md#L23-L92)）。 | WordPress prospective Campaignに不要なservice、export、patch workflowまで持つとLOCとmaintenance surfaceだけが増える。contract semanticsだけを借りる。 |
| Deep scanを通常運転にする | Codex Security Deepは同じscopeへ独立したcomplete Standard scanを反復してaggregateする（[Deep skill](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/skills/deep-security-scan/SKILL.md#L1-L14)）。 | variance低減には効くが、現行pilotは一回でも約398万tokenを使って未完了だった。repeat countより先にstage budgetを直す。 |
| production / bounty contextをtechnical validityへ混ぜる | Cloudflare VDRはroute trafficとsecurity eventsをpriorityへ使う一方、vulnerability existenceはsource evidenceで裏付けると明記する（[VDR](https://blog.cloudflare.com/vulnerability-discovery-remediation/#adding-context-to-a-vulnerability-harness)）。 | programme、payout、既知CVEをResearchへ渡すとProspective評価を汚す。production contextもFinding後のpriorityまたは再現計画に限定する。 |
| fleet-scale機能を先回りする | Cloudflare自身が最小HarnessはRecon / Hunt / Validateとdatabaseでよく、複数repoが必要になるまでcross-repo tracingを、noiseに溺れるまで専用Dedup agentを作るなと勧めている（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#it-all-starts-with-a-skill)）。 | 現行の優先事項は一件完走であり、Trace、Feedback、central Finding service、50–200 worker運用ではない。 |

## Assessment of the original design

独自であること自体は問題ではない。参照Harnessは対象、権限、実行環境、評価目的が異なるため、差分に明確なsecurity propertyまたはProspective evidenceがあれば独自設計の方が正しい。

### Keep as deliberate differentiation

- **Oracle separation.** Vulnerability history、programme、payoutをResearchから隔離する。これは公開CVEのmemorizationではなくprospective capabilityを測るために必要である。
- **Broken-security-semantics-first.** sink/CWE quotaより、認証、認可、identity、trust transition、filesystem、deserialization、cross-component invariantを先に考える。Cloudflareの[動的taxonomy](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#dynamic-threat-modeling)やAVDHの[Access Control分析](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation)とも矛盾しない。
- **Minority preservation.** Finder支持数やmodel多数決で候補を消さず、Independent Validationへ渡す。noisy Discoveryを推奨する[Anthropicの原則](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L45-L52)に整合する。
- **WordPress specialization.** role / capability、nonce、AJAX / REST、hook、option、upload、plugin integration等のoracle-safeなdomain knowledgeは汎用Harnessより強くできる場所である。
- **Source Findingとruntime assuranceの分離.** source-only Independent ValidationでFindingを作り、fresh runtime / human結果をVerification Recordとして追記する。host safetyと外部提出品質の両方を保てる。

### Simplify unless evidence justifies it

- **Artifact vocabulary.** Runtime Verification Packet、Triage Reproduction Packet、Human-only Findingへの多段変換は、Finding + Verification Recordで表現できる。
- **Fine-grained control events.** Ledger / CASは残すが、各private stepをpublicly meaningfulなeventにする必要はない。stage resumeとevidence integrityを満たす最小粒度へ縮める。
- **Fixed four-thesis ceiling.** 安全なresource ceilingではあるが、最適値ではない。duplicate率、unique route、Finding生存率、costで決める。
- **Mandatory long stage chain.** Map、Synthesis、Critic、Root、Validationの各段がhigh-impact recallまたはFP削減へ寄与するかをablationする。budgetで後段が一度も走らない構成は失敗である。
- **Two fresh runtime runs for every source Finding.** 外部提出品質には有益だが、人間負荷が高い。AI再現の成功率、human再現率、setup-blocked率を測り、impact別queue policyを調整する。
- **Six internal Research modules as a design target.** Module数を守ることは目的ではない。caller knowledge、変更Locality、replay可能性が改善しないModule boundaryは統合する。

判断基準は「他社と同じか」ではなく次の五つである。

| Dimension | Evidence required before keeping extra complexity |
| --- | --- |
| High-impact recall | net-new high-impact candidate / Finding、partial chainからの昇格、held-out targetでの比較 |
| Validation quality | source Findingのruntime-confirm率、disproved率、setup-blocked率、human再現率 |
| Maintainability | hot-path LOC、public concept数、変更file数、legacy writer数、test fixture世代数 |
| Coverage honesty | reviewed / deferred / unknownを区別でき、未完了をno-findingsへ丸めないこと |
| Operations | Target/hour、Finding当たりcost、resume時の再実行量、人間review分、failure分類 |

## Current fit against Argus controls

Argusの記事から検証できるのは10個のcontrol verbとmodel-agnostic方針だけである（[official article](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)）。以下はArgus実装の再現ではなく、現行Harnessをそのverbで評価した結果である。

| Verb | Current fit | Assessment |
| --- | --- | --- |
| Confine | manifest-bound source tools、credential/network分離、gVisor Human environment | Strong |
| Constrain | scope、tool、parallelism、USD/time/Wave ceilingをmodel外で強制 | Strong |
| Focus | high-impact goalや具体的Gapを与え、file/CWE/手順を固定しない | Strong |
| Motivate | high-impact semantic recallを最優先する | Policyは明確、Prospective実績は未測定 |
| Parallelize | Source Mapping + 最大4 independent thesis | Initial Waveは実装済み。focus別重複率は未測定 |
| Hypothesize | premise、route、impact、unknown、falsifierをtyped artifact化 | Strongだがartifact数の費用対効果は未測定 |
| Verify | single fresh source Validation、AI Reproduction、別fresh Human Verification | 各段は実装済みだが新Finding lifecycleへ移行中 |
| Record | append-only Ledger、immutable CAS、checkpoint、replay | Strongだが重い |
| Prioritize | Root EvaluationとDepth Admission | 実装済み。最初のProspective runはRoot Evaluation前にbudget停止 |
| Iterate | Synthesis、Critic、Missing-link、Closure | Missing-link / Closureがv6未接続 |

## Concrete weaknesses

1. **Root Evaluationのbudget admissionは実際に誤っていた。** 最初のProspectiveでは探索後にRoot Evaluatorの100,000 token reservationを確保できず、mandatoryな評価へ到達しなかった。[#123](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/123)でprospective follow-up前の修正対象にした。
2. **Coverage / Iterateが未完成。** v6 Missing-link / Closureがつながっていない。Argusの[`iterate`](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)、Cloudflareの[Gapfill](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#stage-1-vulnerability-discovery-harness-vdh)、Codex Securityの[structured coverage](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L105-L163)に対する最大の差である。
3. **Finding lifecycleは移行中である。** current writerはRuntime Verification PacketからHuman-only Findingへ進む。accepted designはIndependent Validationがsource-validated Findingを作り、runtime / human outcomeをappend-only Verification Recordにする。
4. **Prospective evidenceは一件のpartial runだけである。** oracle-free source Researchのcostは測れたが、Root Evaluation前に停止したためrecall、FP、runtime成立率は評価できない。
5. **source screenと二段runtime reproductionのバランスが未検証である。** AIのruntime成立率、人間の再現率、Escalation Queue量、review時間をProspectiveで測れていない。
6. **model-agnosticはinterfaceだけである。** 現実装はClaude Adapterだけで、Finder、Root、Validatorの相関誤りを異なるproviderで比較できない。
7. **control planeが研究実績に先行している。** fine-grained schema、Ledger、CAS、fresh role分離は安全だが、targets/hourやreview minutesを改善する証拠がない部分は過剰設計になり得る。
8. **外側は狭いが内側のSeamが広い。** `openResearch`はrunner / readerだけを公開する一方、internal recordとlegacy互換の表面積が大きい。current writeとlegacy read/replayをさらに分離する余地がある。

次は最初の計測をbudget admission判断へ入力し、現行public seamを使ってfreshなfollow-upを回す。`candidate -> source-validated Finding -> runtime-confirmed -> human-confirmed`率、disproved理由、setup-blocked率、review時間、Finding当たりcost、Coverage stateを測る。その後にThreat Model / Gapfill policy、二つ目のprovider、外側Interfaceの必要性を決める。

## First Prospective measurement

Issue #109のsingle-target runは、durable Approved Target Batch、dispatch直前のversion / digest再検証、oracle-free source Research、Ledger / CAS replayまでをproduction seamで通した。Target sourceは実行せず、programme情報とcredentialをworkerへ渡さなかった。

| Metric | Observed |
| --- | ---: |
| Provider attempts | 3 completed / 3 started |
| Durable checkpoints | 13 |
| Hypothesis / Route Fragment / Frontier Gap | 3 / 3 / 7 |
| Model tokens / estimated cost | 3,976,741 / USD 7.1014455 |
| Model wall time / source queries | 1,170,960 ms / 80 |
| Root Evaluation / Validation | 0 / 0 |
| Runtime Verification Packet / AI Reproduction / Human Verification | 0 / not started / not queued |

探索ownerの3,600,000 token ceilingに対してreported usageが3,976,741となり、campaign全体の残りは23,259 tokenだった。次のRoot Evaluatorが要求する100,000 token reservationを満たせず、source dispositionは`evaluation-incomplete`、Target Research Historyは`budget-exhausted`の`Incomplete`で閉じた。400,000 token / USD 30のValidation reserveは全量未使用である。

これはnegative resultでもCoverage Closureでもない。Root Evaluationとsingle fresh Validationが実行されていないため、候補0件を「脆弱性なし」へ読み替えず、coverageは`unknown`のままにする。budget overshootと次段reservationの関係は、次のpilot前に別の設計判断として扱う。

## Operational observability

[Anthropicのraw transcript追跡](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L100-L115)と[Codex Securityのprogress、cost、partial-result recovery](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/sdk/typescript/README.md#L578-L598)を組み合わせる方針は妥当である。ただしEvidenceの正本はdebug streamではなくResearch Recordとする。

| Reference | Observed practice | Local decision |
| --- | --- | --- |
| Anthropic | tool/text transcript、逐次result、resumeを保存する。transcript writerは`flush()`を使うがdurabilityを保証する`fsync()`ではない（[`agent.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L340-L347)、[pipeline recovery](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L161-L170)）。 | debug transcriptは観測用、CAS / Ledgerだけをreplay authorityにする。 |
| Codex Security | model、token、costをresult / history / bulk receiptへ記録し、cost limit到達時もcompleted discoveryからpartial reportとunvalidated follow-upを残す（[SDK](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/sdk/typescript/README.md#L578-L598)）。 | budget停止をnegativeへ丸めず、保存済みcandidateと未完了stageを一つのprojectionで示す。 |
| Cloudflare | exceptionだけでなく`200 OK` stream内のerror textも明示分類しないとempty runを成功と誤認すると報告する（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#stage-1-vulnerability-discovery-harness-vdh)）。 | provider adapterにtransport successとsemantic completionの別判定を持たせる。 |
