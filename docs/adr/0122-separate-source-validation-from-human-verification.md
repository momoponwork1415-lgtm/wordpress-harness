---
status: accepted
supersedes: 0007, 0008, 0067, 0068, 0085, 0119, 0121
---

# Separate source Validation from human Verification

## Decision

Researchはhigh-recallなExplorationの後に、Target sourceだけを読む独立`Validation`を行い、十分に閉じたcandidateをversioned `Human Review Packet`としてHuman OSへ渡す。Researchはruntime Verificationまたは新しいFindingの生成を所有しない。Human OSがfreshな隔離環境で`Human Verification`を行い、成立を人間が確認した時だけFindingへ昇格する。

ValidationはWave BarrierとRoot Evaluationの後に開始する。durableな途中checkpointは失わないが、checkpoint直後にcandidateをFinding gateへ流さない。まず同じTarget Snapshot内のexact duplicateを決定的にまとめ、共通rubricを使う二つのfresh Validation Attemptへ送る。reachability、control、premise、causal routeまたはsecurity effectについてmaterialな事実衝突がある時だけ三つ目を開始する。最後のValidation Synthesisはsource toolを持たず、支持数または多数決ではなく、各Attemptがsource anchorへ結び付けた根拠と反証だけから次を決める。

- `ready-for-human`: source integrity、reachabilityとpremise、broken control、causal routeとsecurity effect、counterevidenceがすべて支持され、残るunknownがruntime reproductionである。
- `needs-research`: 判断可能な一つ以上のproof gapが残り、同じApproach FamilyのFrontier Gapとして戻せる。
- `disproven`: exact routeまたはpremiseを否定する決定的なsource evidenceがある。
- `rejected`: 挙動は実在してもsecurity propertyの破壊またはtechnical threat scopeに該当しない。
- `validation-pending`: provider、budgetまたは必要なAttempt不足によりValidationがterminalでない。false positive、rejectedまたはHuman Deferredへ読み替えない。

`needs-research`は具体的なrequired fact、source evidence、falsifier、次actionを持つ時だけ、元のApproach Familyへ戻す。新しいFamilyを暗黙に作らず、そのFamilyの既存三Wave envelopeを消費する。上限で閉じなければ`validation-pending`として残す。

ValidityのSynthesis後にRisk Assessmentを別artifactとして作る。attacker role、prerequisite、exposed surface、effect、configuration、blast radiusを構造化できるが、severityまたはprogramme eligibilityでValidityを変更しない。Human OSの初期運用policyは一Campaign最大三つのactive mechanismとし、残る`ready-for-human` packetは削除せず`Human Deferred`として保持する。

Human Verificationはfreshで使い捨て可能な隔離環境、実Target interface、固定Target/version、attacker role、手順、観測effect、実施者と時刻を必要とする。proof methodは人間がcaseごとに判断し、機械生成されたWitness、Causal Control、fresh sibling LabまたはgVisorを全Findingの必須形式にはしない。ただしhost上のtarget実行、production credential/data、許可外egress、永続化、reverse shellは引き続き禁止する。

既存のgVisor Verification Labは`Human Verification Assistant`としてHuman OSから任意利用できる。Assistantが機械的なevidentiary pairを生成する場合、ADR 0007、0008、0067、0068、0121で定めたWitness、Causal Control、fresh sibling、observable effect、no-fallback isolationをそのAssistant evidenceへ引き続き適用する。Assistantが未対応または利用不能でもReview Packetのhandoffと人間の判断を阻害しない。

既存LedgerのVerification/Finding artifactとschemaは変更せず、read-only replayでは`legacy automated finding`として元の意味を保つ。新policyのCampaignと同じmetricへ混ぜず、旧Findingを新Findingへ変換する場合は新しいReview PacketとHuman Verificationを作る。

## Rationale

旧設計は全candidateへfresh Lab、実行可能Witness、Causal Control、gVisor siblingを要求したため、未対応mechanismと環境構築費用がcandidateの技術的価値より先にResearchを停止させた。またResearchがFindingを生成してから人間が同じ主張を再確認する二重Verificationになり、Human Reviewへ送るためのsource closureと、最終的なruntime実証が同じgateへ結合していた。

Mandiant AVDHの公開設計から、hypothesis generation後に複数の独立Validation agentと一つのValidation Synthesisを置き、confirmed/disproven/rejectedを分け、最後に人間がdynamic reproductionする構造を採る。language/framework/vulnerabilityのDistilled Knowledgeも採るが、vulnerability ruleはlate Validationだけへ適用し、Finderの固定checklistにはしない。二Attemptとmaterial conflict時だけの三Attempt目、source-only tool境界、rubric、Approach Familyへの戻し方、WordPress threat baselineはこのrepositoryのcost・recall・trust boundaryに合わせた適応である。

Anthropic Defending Code Reference HarnessからはDiscoveryとfresh reviewの分離、candidateを捨てないdurable artifact、隔離された実行支援を維持する。Codex Securityからはsource、closest control、precondition、evidence、proof gapを構造化し、static/model verdictだけでFindingへ昇格させない考え方を維持する。

## Consequences

- ResearchのModule構成は`Verification`を`Validation`へ置き換え、ResearchのterminalはReview Packet handoffで閉じる。
- Human OSはHuman Verification、Human Deferred、Findingと判断履歴を所有し、Research Ledgerまたは内部CASを直接読まない。
- Campaign Controlはcheckpoint即時Verificationを廃止し、Wave Barrier、Root Evaluation、dedup後にValidationをscheduleする。
- Coverage ClosureとApproach Familyのpending stateはVerification outcomeではなく、Exploration workとValidation dispositionから再定義する。
- 自動ValidationのUSD予約はCampaign budget内に維持するが、Lab costを含めない。初期baselineでは同一modelを使い、cheap modelへの置換はcohort ablation後に限る。
- Human rejectionは即座に自動FP ruleへしない。構造化理由、rule proposal、人間の一般化review、versioned policy、Development Cohort regressionを経て次Campaignへだけ適用する。

## References

- [Mandiant AVDH — Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
- [Anthropic Defending Code Reference Harness — Best Practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
- [OpenAI Codex Security — Validation](https://github.com/openai/codex-security/blob/main/plugins/codex-security/skills/validation/SKILL.md)
