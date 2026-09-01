---
status: accepted
---

# Introduce a Semgrep-first static rule lane in Milestone 2

Milestone 1のBrizy closed loopへstatic rule engineを追加せず、Milestone 2の開始時に独立した`Static Rule Lane`を導入する。

Verified Findingごとに、LLMはCausal Identityとsource evidenceから`Rule Proposal`を作る。ただし、意味のある精度で構文へ落とせない場合は、無理に一般化せず`Not Codifiable Record`へ理由、失われるcross-file reasoning、将来必要なanalysis capabilityを記録する。

WordPress pluginの主要言語であるPHPにはCodeQL extractorがないため、最初のtarget-side engineはSemgrep OSSとする。CodeQLはJavaScript/TypeScriptなど公式対応言語を含むTarget Snapshotにだけcapability-gatedで使い、PHP analysisの必須要素またはfallbackとして扱わない。PHPのcross-file analysisが必要になった場合は、Semgrepの利用可能なengine capabilityまたは別のPHP-native analysisを独立に評価する。

Rule Proposalは次をすべて満たすまで`Accepted Static Rule`へ昇格させない。

1. engine、engine version、rule version、対象言語、由来Finding、Causal Identity、意図したscopeと既知limitを固定する
2. rule validationとrule unit testを通す
3. Boundary Pairのvulnerable positiveを検出する
4. actual patched negativeとbenign functional controlを検出しない
5. representative benign corpusで許容false-positive budgetを超えない
6. 人間がmatchをroot causeと照合する

Static rule matchは`Hypothesis`だけを生成し、Findingへ直接昇格させない。通常の独立Verifier、Witness、Causal Control、Skeptic、evidence gateを必ず通す。Development Cohort由来のruleを同Caseの探索能力評価へ混ぜず、rule-assisted laneの成績をagentic discovery laneと分離して記録する。

自作ruleは、既知Findingから近いvariantを安価かつ決定的に回収するfloorである。cross-file reasoningや未知のmechanismを発見するagentic iterationの代替にはしない。
