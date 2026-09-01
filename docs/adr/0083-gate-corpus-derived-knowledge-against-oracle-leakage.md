---
status: accepted
---

# Gate corpus-derived knowledge against oracle leakage

daroo Researcher Reference Corpus等の公開FindingからKnowledge Capsule候補を作れるが、public_identity、researcher、plugin/theme名、slug、version、CVE、advisory URL、case固有symbol・parameter・payload、patch diff、patch narrativeをprospective worker入力から除く。control planeはprovenanceを保持するが、renderされたPrompt Setには一般化したWordPress mechanism、security property、失敗しやすいtrust transition、反証方法だけを含める。

候補Capsuleは`Oracle Leakage Gate`を通す。deterministic identifier scan、人間review、由来Caseを除外したDevelopment Cohort評価、未使用Sealed Evaluation Cohortで、oracle contaminationなしに探索またはVerificationを改善した場合だけglobal Knowledgeとして昇格する。由来Caseのrediscovery scoreへ同じCapsuleを使わない。

情報を十分に一般化できない場合はKnowledge Capsuleへ昇格させず、Researcher Reference Corpusのcoverage分析またはCase固有Lesson Proposalに留める。
