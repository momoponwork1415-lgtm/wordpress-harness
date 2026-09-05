---
status: accepted
supersedes: 0122
---

# Use one source screen before AI reproduction and mandatory human reproduction

## Decision

ResearchはWave Barrier、Root Evaluation、exact dedupの後、一つのfreshな`Independent Validation Attempt`だけを行う。ValidatorはFinderのconversation、scratch、verdictを共有せず、固定Target Snapshotのread-only sourceだけで共通rubricを評価する。二つ目・条件付き第三Attemptとmodelによる`Validation Synthesis`はcurrent Campaignで行わない。

Validationは最終Validityを判定せず、明白なfalse positiveだけを除く。決定的なsource contradictionは`disproven`、実行に必要な具体的proof gapは`needs-research`、providerまたはbudget failureは`validation-pending`とする。反証がなく、attacker premise、Security Effect、runtimeで試せるrouteがあるcandidateを`ready-for-runtime`として自己完結したversioned `Runtime Verification Packet`へ投影する。Riskはsingle Validationとbind済みCandidate / Threat Contextから追加model callなしで決定する。Researchは`rejected`またはFindingを作らない。

Human OSの`AI Reproduction`はfreshな使い捨て隔離環境と実Target interfaceでRuntime Verification Packetを試す。成功時は脆弱性class別またはgenericな`Reproduction Recipe`、runtime identity、観測、Private Evidence Bundleへの参照を`Triage Reproduction Packet`へ固定する。classはRecipeのsuccess criterionを助けるが、固定Adapterへの対応をcandidateの入場条件にしない。AIはFinding、最終verdictまたはprogramme eligibilityを作らない。

AIがSecurity Effectを観測したTriage Reproduction Packetだけを通常のHuman Verification Queueへ送る。high-impactだがAIが閉じられないcandidateは`runtime-inconclusive`として別のEscalation Queueへ残し、人間が明示的に選べる。source反証、Assistant failure、unsupported mechanismまたはsetup failureをHuman rejectionへ読み替えない。

Human Verificationでは、AI instanceと異なるfresh environmentを同じTarget/version、Runtime Profile、Setup Planから作り、人間がRecipeを必ず再実行する。直前のCurrent Version Reviewで新しいstable versionが見つかれば元Campaign Snapshotを保持したまま、そのversionでAI ReproductionとRecipeを更新してから人間へ渡す。軽微な操作差分は記録できるが、別のcausal routeを必要とする時は新しいRecipeへ戻す。条件一致かつeffect非観測だけを`rejected`とし、環境不一致は`blocked`、曖昧な結果は`runtime-inconclusive`とする。人間の再実行成功だけがFindingを生成できる。

exact payload、HTTP request、screenshot、runtime logはHuman OSのPrivate Evidence Bundleへ保存し、Research LedgerまたはGitへ入れない。Submission DraftはHuman Verification後にこの証拠と人間の観測から作り、外部送信は別の人間承認を必要とする。

Coverage policyが未決でもcandidateはHuman OSへ進められる。ただしno-finding Campaignをsafeまたはcoverage-closedと表現せず、`coverage-unknown`または理由付き`Incomplete`として残す。Map-freeとmap-assistedの実測比較後にclosure policyを決める。

## Rationale

二つまたは三つのsource Validatorと別Synthesisは明らかなfalse positiveを減らせる一方、同じsource claimへmodel costを重ねてもruntime成立性を閉じない。一回の独立source screen、AI reproduction、人間によるtriage相当のfresh reproductionへ予算を配分する方が、false positiveを抑えながら実際の提出判断へ直接つながる。

AVDHからDiscoveryとfresh Validationの分離、source-bound rebuttal、human dynamic verificationを採る。複数ValidatorとSynthesisは必須構造として採用しない。Anthropicからdurable candidate handoffと早期実Target運用、Codex Securityから明示的なproof gapと不確実性をnegativeへ丸めない原則を維持する。

## Consequences

- Researchはsource-onlyであり、Runtime Verification Packetまでを所有する。
- Human OSはAI Reproduction、Private Evidence Bundle、Triage Reproduction Packet、mandatory Human Verification、Findingを所有する。
- current Validationのmodel callはcandidate当たり原則一回になる。
- legacy multi-Attempt / Synthesis artifactはread-only replayで元の意味を保つ。
- Human queueの総数は制限せず、設定可能なactive concurrencyだけを制限する。
- residual false positiveは必須のHuman reproductionで理由付きに棄却し、直ちに自動ruleへ一般化しない。
- first real Prospective CampaignはCoverage Closure、Target Intelligence自動化または三Target cohortを待たない。

## References

- [Mandiant AVDH — Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
- [Anthropic Defending Code Reference Harness — Best Practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
- [OpenAI Codex Security — Validation](https://github.com/openai/codex-security/blob/main/plugins/codex-security/skills/validation/SKILL.md)
- [Issue #107](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107)
- [Issue #108](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)
