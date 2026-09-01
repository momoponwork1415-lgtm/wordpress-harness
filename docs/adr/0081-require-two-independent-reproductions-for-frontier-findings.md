---
status: accepted
---

# Require two independent reproductions for Frontier Findings

RCEまたは同等のsite-wide compromiseを主張するFrontier Hypothesisは、一回のVerificationでFindingへ昇格させない。同一Target Snapshot、runtime tuple、Configuration Variant、essential Evidence Routeに対し、異なるAttempt、異なるExecution Canary、fresh Agent Sandbox、fresh sibling Witness/Control Labsを使う`Independent Reproduction`を二回成功させ、その後Human Confirmationへ送る。

第二Verifierへ第一Attemptのconversation、scratch、payload、Experiment implementation、raw observationを渡さず、固定Target Snapshot、scope、正規化Hypothesis、事前定義したsecurity propertyだけを渡す。第二Verifierはroute、Experiment Plan、Causal Controlを独立に再導出する。両者のWitness、Causal Control、essential routeが一致しなければFindingへ昇格せず、差異を新しいFrontier Gapとして扱う。

Milestone 1はStored XSS mechanicsの検証なのでこのgateの合格を要求しない。Milestone 1でFrontier Hypothesisが生じた場合は保留し、Milestone 2の独立再現環境で二回成功するまでFrontier Findingと呼ばない。
