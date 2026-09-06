# Research Design

Status: accepted research policy, 2026-09-06

## Goal

既知脆弱性のoracleなしに、high-impactなbroken security semanticsを高recallで発見する。freshなIndependent Validationで明らかなfalse positiveを抑えてFindingを生成し、fresh runtime verificationと人間の外部提出判断まで閉じる。

**Do not optimize for sinks. Optimize for broken security semantics.**

RCEとsite-wide compromiseは最上位impactだが唯一の成功条件ではない。SQLi、Stored XSS、ATO、PrivEsc、file operation、object injection、authorization、business-logic failureも重大candidateとして扱う。

通常運転はraw-source-firstのSemantic Research Wave。current normal Waveは互いに独立した3 Finderとし、target-specific thesisを最大2、whole-target wildcard thesisを最低1維持する。4 FinderはPlan schemaとCampaign budgetのhard ceilingであり、明示的policy overrideに限る。重大HypothesisはIndependent Validationへ送り、strong semantic frontierだけをconditional Depthへ送る。

現在のResearch attacker scopeは、未認証、built-in Subscriber、またはeffective capabilityがSubscriberを超えないcustom roleだけである。WooCommerce `customer`は既知のsubscriber-equivalentとして扱う。最低開始権限がContributor以上または`unresolved`のrouteはValidation、Finding、Runtime Verificationへ進めない。許可された開始権限から途中で昇格するrouteは対象に含む。legacy artifactの広いpremise enumはreplay互換のため維持する。

優先順位は次のとおり。

```text
high-impact recall
  -> root-cause quality
  -> attacker-premise closure
  -> independent validation
  -> false-positive behavior
  -> token / cost
```

Cost削減はrecall baseline確立後のablationで行う。

## Control properties

[Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)の10動詞をpipelineではなくCampaign全体のcontrol propertyとして使う。

| Property | Harness policy |
| --- | --- |
| Confine | Target、worker、credential、runtime、networkを隔離する |
| Constrain | scope、budget、tool、並列数、stopをmodel外で強制する |
| Focus | security goalやmissing linkを与え、file / CWE / 手順を固定しない |
| Motivate | 重大candidateとhigh-impact frontierの両方を追う |
| Parallelize | 独立thesisを結果非共有で並行する |
| Hypothesize | premise、route、impact、unknown、falsifierをartifact化する |
| Verify | FinderとIndependent Validationを分け、FindingへAI / human Verification Recordを追記する |
| Record | positive、negative、blocked、unknown、Fragmentを記録する |
| Prioritize | impact、premise、novelty、frontier、costから次workを選ぶ |
| Iterate | Synthesis、Critic、Missing-link Waveで具体的Gapを閉じる |

## Adopted harness practices

[Anthropic Defending Code Reference Harness](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)を次の形で採用する。

| Practice | Adaptation |
| --- | --- |
| systemを把握して探索を分割する | source-aware Reconで独立thesisを作る。Mapやfile集合を境界にしない |
| modelへcontext toolを渡す | Snapshot-bound `list / search / read`を使う |
| DiscoveryとValidationを分ける | conversation、scratch、verdictを共有しない |
| validatorへ投資する | freshなIndependent ValidationだけがFindingを生成し、AIと人間の独立runtime verificationへ予算を移す |
| Finder / Critic / Judgeを分ける | Depth roleをfresh Attemptへ分離する |
| independent runのunionを取る | 多数決ではなくsource-bound candidateの和集合を保つ |
| partial chainをfresh runへ返す | Frontier GapをMissing-link Waveへ渡す |
| 実Targetを早く回す | 完全Mapを待たずvertical sliceを実測する |

Anthropicの“map the system first”を完全なSurface Mapの強制とは解釈しない。FinderがTargetをnavigateでき、独立した研究方向を持てればよい。

## Modes

| Mode | Start | Goal |
| --- | --- | --- |
| Semantic Research | 全Campaign | candidate、frontier、根拠付きstop |
| Conditional Depth | high-impact potentialのある具体的frontier | source-bound routeまたは根拠付きstop |
| Breadth | recall baseline確立後 | recallを維持したtargets/hourとcost改善 |

Surface Map、PHP Program Index、AST、Semgrep、CodeQLはnavigation、evidence、coverage、pattern expansion用。Map外candidateの拒否やsafe判定には使わない。

単発で重大なcandidateを、長いchainでない理由で未完成扱いしない。低severity Fragmentもhigh-impactへ伸びる具体的可能性があれば保持する。

## Decision rules

1. Finderへfile、CWE、固定手順を強制しない。
2. current Campaignのattacker scopeはHarnessの共通境界で固定し、prompt、provider output schema、Root Evaluation、Validation、Finding、Runtime Verificationで強制する。
3. Harnessは隔離、provenance、budget、artifact、barrier、freshness、stopを管理する。research decisionはagentへ残す。
4. 支持数、model confidence、到着順でcandidateを捨てない。
5. 一つのcandidate後もstrong frontierがあれば終了しない。
6. Depth Admissionはknown final impactではなくhigh-impact potentialで決める。
7. Finder自身はFindingを作らない。freshなIndependent Validationだけがsource-validated Findingを生成する。
8. budget exhaustion、validation-pending、setup-blockedをnegativeへ丸めない。
9. Map-first v1とlegacy Verificationはread/replay互換に限る。
10. Coverage policy未決のno-finding Campaignをsafeまたはcoverage-closedと表現しない。
11. AI / human runtime結果はFindingを上書きせずVerification Recordとして追記し、人間の必須gateはexact Draft revisionの外部提出承認に置く。

## Change gate

探索変更は次を説明できる場合だけ採用する。

- recall baselineをどう保護するか。
- Discovery、Independent Validation、Runtime Verificationのどこに属するか。
- raw-source / Map外candidate / minority routeを失わないか。
- providerを替えてもartifactとsecurity boundaryを保てるか。
- negative、blocked、unknown、Fragmentを再生できるか。
- cost変更が同じoracle-separated cohortでのablationか。

## References

- [Google Cloud / Mandiant — Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
- [Anthropic — Defending Code Reference Harness](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
- [Wordfence — Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)
- [ADR 0117](adr/0117-optimize-for-high-impact-semantic-recall.md) · [ADR 0124](adr/0124-align-campaign-and-finding-lifecycle-with-reference-harnesses.md)

darooの公開portfolioはmechanism breadthの水準確認にだけ使う。非公開methodを推測せず、CVE、patch、payloadをprospective workerへ渡さない。AnthropicとCodex Securityの実装比較は[Knowledge](knowledge/reference-harness-observability.md)に置く。
