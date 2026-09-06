# Knowledge: reference harness comparison

Status: implementation-checked external reference and first Prospective measurement, 2026-09-06

## Conclusion

設計方向は妥当だが、参照実装と同じ工程名やstage graphを採る必要はない。Argusのcontrol properties、Anthropicの探索と検証の分離、Codex Securityのdurable Finding / coverage、Cloudflareの小さい反復、AVDHのfresh Validationを判断材料にし、現行Semantic Waveやconditional DepthはProspective実測で優位性が反証されるまで維持する。[ADR 0124](../adr/0124-align-campaign-and-finding-lifecycle-with-reference-harnesses.md)はFinding lifecycleだけを変更する。

弱いのは設計原則ではなく実証である。最初の実Target Prospective Campaignはsource Researchまで到達したが、Root Evaluation前にbudgetで`Incomplete`となった。v6のMissing-link / Closureと二段runtime reproductionは未実証であり、high recall、false-positive率、human負荷をまだ比較できない（[Codebase Guide](../CODEBASE-GUIDE.md)）。

## Fixed sources

| Reference | Checked source |
| --- | --- |
| Wordfence Argus | [official article, 2026-08-27](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/) |
| Anthropic | [`defending-code-reference-harness@d3bea6b`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) |
| OpenAI | [`codex-security@c829688`](https://github.com/openai/codex-security/tree/c8296885fbbf593edc1b405dc49859496b2bd8e4) |
| Cloudflare | [Build your own vulnerability harness](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)、[Vulnerability Discovery and Remediation](https://blog.cloudflare.com/vulnerability-discovery-remediation/) |
| Google / Mandiant AVDH | [official architecture and evaluation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) |
| Current harness | [Research Design](../RESEARCH-DESIGN.md), [Architecture](../ARCHITECTURE.md), [Codebase Guide](../CODEBASE-GUIDE.md) |

Argusの公式記事は10動詞、model-agnostic方針、目的だけを公開し、内部architecture、prompt、model、harness designは非公開としている。したがって実装方式の優劣は比較できない。

## Where the design comes from

| Source | Adopted here | Intentional deviation |
| --- | --- | --- |
| Argus | `confine / constrain / focus / motivate / parallelize / hypothesize / verify / record / prioritize / iterate`をCampaign全体のcontrol propertyにする | 10段pipelineや内部実装を推測しない（[Research Design](../RESEARCH-DESIGN.md)、lines 28-43） |
| Anthropic | Recon、独立run、candidateのunion、Discoveryとfresh Verificationの分離、partial chainをfresh runへ戻す（[best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L19-L78)） | 完全Map、agent shell、Research中のtarget実行を必須にしない。C/C++ pipelineのASAN PoC → fresh Gradeとは異なる（[pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L40-L84)） |
| Codex Security | immutable target identity、partial outcome、coverage、checkpoint、canonical artifactとprojectionの分離（[scan contract](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L1-L48)） | 汎用repository/diff scannerではなく、prospective WordPress Campaignとruntime / submission decisionまでを所有する |
| Cloudflare | Recon / Hunt / Validateのrole分離、model外のdurable state、独立Validator、Gapfill、失敗をclean resultへ丸めないcontrol | area x attack-classの固定cell、Research中の実行、production traffic / WAF contextを必須にしない。prospective公平性を優先する |
| AVDH | Threat Model、Discoveryから独立したfresh Validation、source-bound反証、human dynamic verification（[official architecture](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)） | fresh Validationとassurance分離を採り、AVDHのwaterfallやThreat Model gate自体は移植しない（[ADR 0124](../adr/0124-align-campaign-and-finding-lifecycle-with-reference-harnesses.md)） |

独自性が高いのは次である。

- vulnerability oracleとprogramme/payout情報をResearchから隔離するprospective Campaign。
- `Target Intelligence -> Research -> Human OS`のversioned handoffと、Finding後の外部提出だけを人間が許可するownership。
- sink/CWE quotaではなくbroken security semanticsとstrong semantic frontierからconditional Depthへ進む設計。
- 支持数や多数決でminority candidateを捨てず、negative、blocked、unknownもLedger / CASへ残す設計。

## Argus ten-verb fit

| Verb | Current fit | Assessment |
| --- | --- | --- |
| Confine | manifest-bound source tools、credential/network分離、gVisor Human environment | Strong |
| Constrain | scope、tool、parallelism、USD/time/Wave ceilingをmodel外で強制 | Strong |
| Focus | high-impact goalや具体的Gapを与え、file/CWE/手順を固定しない | Strong |
| Motivate | high-impact semantic recallを最優先する | Policyは明確、Prospective実績は未測定 |
| Parallelize | Recon + Baseline、最大4 independent thesis | Initial Waveは実装済み |
| Hypothesize | premise、route、impact、unknown、falsifierをtyped artifact化 | Strong |
| Verify | single fresh source screen、AI Reproduction、別fresh環境での必須Human Reproduction | 移行中。runtime成立率とHuman再現率のProspective実測は未完 |
| Record | append-only Ledger、immutable CAS、checkpoint、replay | Strong |
| Prioritize | Root EvaluationとDepth Admission | 実装済み。最初のProspective計測はRoot Evaluationのadmission前にbudgetで停止 |
| Iterate | Synthesis、Critic、Missing-link、Closure | Missing-link / Closureがv6未接続 |

Argusの“iterate hard and fast”まで含めると、現Harnessはまだ不合格である。重いartifact chainとHuman gateを持つ以上、同等のtempoは実測で示す必要がある。

## Comparison

| Concern | Anthropic | Codex Security | Current harness |
| --- | --- | --- | --- |
| Exploration | threat modelからsurfaceを分割 | parent mapping + independent audit。Deepはcomplete Standard scanを反復（[Deep](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/skills/deep-security-scan/SKILL.md#L1-L14)） | raw-source thesisを自由化し、Mapは補助。minority routeを保持 |
| Validation | cheap deterministic gate、category別route、fresh executable grader | proportionateなPoC/test/debuggerを優先し、無理ならstatic proof gap（[Validation](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/skills/validation/SKILL.md#L27-L44)） | 一つのsource screen後、AIがclass別またはgeneric Recipeを作り、人間が別fresh環境で同じRecipeを必ず再実行 |
| State | transcriptと段階artifactを逐次保存 | sealed manifest/findings/coverage、stopped partialを保持 | event-level Ledger + CAS。最も細かいが最も重い |
| Completion | executable finding/report | explicit coverage completeness | evidence-backed Closure設計だがv6未接続 |
| Human boundary | external report前にreal releaseで再現 | reportable Findingをscanが生成 | accepted designではIndependent ValidationがFindingを生成し、人間は外部提出を承認。current writerは移行前 |
| Product maturity | autonomous C/C++ reference pipeline | CLI、SDK、bulk scan、findings/dedupe service、複数provider（[README](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/README.md#L23-L92)） | thin CLI、Claude Adapterのみ、unattended dispatch未接続 |

CloudflareとAVDHは現在の弱点を別方向から示す。

| Concern | Cloudflare | AVDH | Current harness implication |
| --- | --- | --- | --- |
| 最小構成 | 約450行のskillから始め、実測されたbottleneckにだけorchestrationを足す | deterministic waterfallと専門agentを先に定義する | 既に細かいcontrol planeを持つため、これ以上の抽象化より一件完走を優先する |
| Threat model | Reconでsurfaceとattack classを動的に作る | asset / SBOM / architecture / threat intelligenceから合成し、分析前にconsultantが承認する | 現在は共通attacker scopeが主で、plugin固有のtrust boundaryを承認するgateがない |
| Coverage | area x attack-classのGapfill、net-new findingとcoverage growthを観測する | in-scope fileごとのentry point inventoryから分析を展開する | free thesisはminority routeを守る一方、v6 Closure未接続の現在はsystematic coverageが弱い |
| Validation | Hunterと別のValidator、untouched sourceに対するPoC、model外のmechanical checks | 複数高温ValidatorとValidation Synthesis、人間のdynamic PoC | single source Validatorは安いが、相関誤りとHuman queue量をまだ測れていない |
| Context | production route / traffic / WAF contextはrisk優先度へ使うがvalidityの根拠にはしない | distilled domain / language / framework knowledgeを全段で使う | oracle分離は強いが、oracle-safeなWordPress固有semanticsまで薄くしすぎる危険がある |

## Concrete weaknesses

1. **Root Evaluationのbudget admissionは実際に誤っていた。** 最初のProspectiveでは探索後にRoot Evaluatorの100,000 token reservationを確保できず、mandatoryな評価へ到達しなかった。[#123](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/123)でprospective follow-up前の修正対象にした。
2. **Coverage / Iterateが未完成。** v6 Missing-link / Closureがつながっていない。Argusの`iterate`、CloudflareのGapfill、Codex Securityのhonest coverageに対する最大の差である。
3. **plugin固有のThreat Model gateが弱い。** 共通のlow-privilege attacker scopeはあるが、codeから得たasset、trust boundary、role / capability、integration premiseをResearch前に人間が承認するAVDH型の境界はない。自由探索を妨げない短いThreat Model artifactが必要かをProspectiveで測る。
4. **Prospective evidenceは一件のpartial runだけである。** oracle-free source Researchのcostは測れたが、Root Evaluation前に停止したためrecall、FP、runtime成立率は評価できない。
5. **source screenと二段runtime reproductionのバランスが未検証。** source側のmodel costは下がるが、AIのruntime成立率、人間の再現率、Escalation Queue量、review時間をProspectiveで測れていない。
6. **model-agnosticはinterfaceだけ。** Argus、Cloudflare、Codex Securityはmodelまたはproviderの独立性を重視するが、現実装はClaude Adapterだけである。Finder、Root、Validatorを同系列modelへ固定すると相関誤りを発見しにくい（[Codebase Guide](../CODEBASE-GUIDE.md)）。
7. **control planeが研究実績に先行している。** fine-grained schema、Ledger、CAS、fresh role分離は安全だが、targets/hourやreview minutesを改善する証拠がなければ過剰設計になる。Cloudflareの最小構成から育てる順序とは逆である。
8. **外側はdeepだが内側のSeamが広い。** `openResearch`はrunner / readerだけを公開する一方、internal `ResearchRecord`は旧版を含む多数の操作を持つ。early Prospective後のstabilizationでcurrent writeとlegacy read/replayをさらに分離する。

次は最初の計測をbudget admission判断へ入力し、現行public seamを使ってfreshなfollow-upを回す。`candidate -> source-validated Finding -> runtime-confirmed -> human-confirmed`率、disproved理由、setup-blocked率、review時間、Finding当たりcost、Coverage stateを測る。その後にThreat Model / Gapfill policyと外側Interfaceの必要性を決める。SQLiやXSS等のclass別Recipeはsuccess criterionを明確にするために使い、固定Adapter対応をcandidateの入場条件にはしない。

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

Anthropicのraw transcript追跡とCodex Securityのtyped progress、cost、partial-result recoveryを組み合わせる方針は妥当である。ただしEvidenceの正本はdebug streamではなくResearch Recordとする。

| Reference | Useful practice |
| --- | --- |
| Anthropic | tool/text preview、heartbeat、raw JSONL、resume。実装は`flush()`であり`fsync()`ではない（[`agent.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L340-L347)） |
| Codex Security | typed worker progress、token/cost、graceful abort、immutable checkpoint、raw scan logs |

2026-09-04の参考計測では、Anthropicはauthored 14,040 LOC / core 4,108 LOC、Codex Security `f2ec53d`はauthored 223,127 LOC / core 66,096 LOCだった。規模は機能範囲を示すだけで、設計品質の比較値にはしない。
