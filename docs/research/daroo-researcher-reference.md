# daroo researcher reference

Status: accepted research-style reference, 2026-09-01

## Source

- [Wordfence Intelligence — daroo](https://www.wordfence.com/threat-intel/vulnerabilities/researchers/daroo-2)

darooは設計参照資料の第4項ではない。harness architectureの根拠は引き続き[3件のDesign references](../REFERENCES.md)とし、darooの公開portfolioは、目指す研究成果、mechanism coverage、Development Case候補、Knowledge Capsule、evaluation gapを具体化する`Researcher Reference`として扱う。

## Publicly observable portfolio

2026-09-01に確認したWordfence profileは、all-time discoveries 285件、all-time ranking 25と表示している。高CVSS順の公開Findingには次のmechanismとchainが含まれる。

- unauthenticated arbitrary file uploadからRCE
- unauthenticatedおよびlow-privilege RCE
- missing authorization、validation bypass、permission collisionからprivilege escalation
- password-resetまたはuser-meta操作からaccount takeover
- file upload metadata、path confusion、arbitrary file deletion/read
- PHP Object Injectionとgadgetまたはsecondary impact
- SQL injection
- multi-stage Stored XSS

これは単一sinkの大量検出ではなく、WordPress固有のregistration、role、nonce、capability、form state、upload lifecycle、path、persistent metadata、later consumerをつなぐrouteを重視すべきことを示す。ただし、これは公開Findingから導くcoverage仮説であり、daroo本人の非公開methodを示すものではない。

## How the harness uses it

- public Findingをroot-cause family、attacker premise、WordPress surface、security property、route lengthで分類する
- Development Cohortと将来のprivate Boundary Pairに不足するmechanismを可視化する
- Mapper、Finder、Verifier、Skepticのbenchmark taskを作る際のcoverage spineにする
- RCEだけでなく、RCEへつながるfile、authorization、identity、state、deserialization、SQL、browser primitiveを残す
- verified Findingからvariant Focus Area、Rule Proposal、regression fixture候補を作る際の比較軸にする

## Guardrails

- researcher名をworker personaまたは権威付けpromptとして使わない
- CVE title、affected version、patch narrative、PoCをprospective workerへ渡さない
- darooのpublic Findingに似ているだけでHypothesisまたはFindingを昇格しない
- public disclosureを未知性の評価対象と同じcohortへ混ぜない
- portfolioの件数を研究能力の代理指標にしない

Researcher Referenceが供給するのは「どの成果水準とmechanism breadthを目指すか」であり、個々のCampaignのanswerではない。

## Milestone 2 Reference Corpus

Milestone 2で、darooの公開Findingをversion固定した`Researcher Reference Corpus`へ正規化する。最小recordは次を持つ。

```yaml
public_identity: advisory or CVE reference
publication_date: public disclosure date
software_family: plugin or theme family
attacker_premise: unauthenticated or lowest required role
wordpress_surface: route, ajax, form, upload, hook, callback, or other surface
root_cause_family: normalized causal mechanism
route_primitives: ordered public-level primitives
security_property: property ultimately broken
impact_family: RCE, site compromise, SQLi, Stored XSS, or other impact
route_shape: local, cross-file, cross-request, persistent-state, or chained
source_refs: public provenance only
```

Corpusはpublic metadataとnormalizationだけをGitへ置き、PoC、payload、非公開report、再現用secretを含めない。Corpus versionとtaxonomy versionを分離し、分類変更で原recordを書き換えずderived projectionを更新する。

Corpusは次にだけ使う。

- Development CohortとKnowledge Capsuleのmechanism coverage gap
- Focus portfolioに欠けるattacker premise、surface、route shapeの可視化
- model/harness評価結果のslice分析
- 将来のBoundary Pair候補選定

Prospective CampaignのPrompt Set、Surface Map、priority factへCorpusのCVE、affected version、patch narrativeを入力しない。

### Acquisition and normalization sequence

最初に全公開Findingの最小metadataを一回取得し、取得日時、source URL、response digestを固定したraw corpus snapshotとして保存する。これはMilestone 3の定期Target Intelligence ingestionではなく、Milestone 2用のoffline development fixtureである。

deep normalizationは次の順で行う。

1. Critical/Highの公開Finding
2. RCE、file、authorization、identity、deserialization、SQL、browser等のmechanism diversityを補うstratified sample
3. Development Cohortまたはprospective結果との比較でcoverage gapになったFinding
4. 残りの公開Finding

未分類または公開情報不足を推測で埋めず`unknown`として残す。全件metadata取得と全件deep normalizationを同じ完了条件にしない。
