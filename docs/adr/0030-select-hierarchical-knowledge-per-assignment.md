---
status: accepted
---

# Select hierarchical Knowledge per Assignment

再利用知識をWordPress core、PHP/language、framework/plugin family、vulnerability mechanismの階層へ分け、Surface Map、Focus Area、worker roleに関係するKnowledge CapsuleだけをPrompt Setへ含める。全知識を常時投入せず、選択したentry、除外したentry、version、provenanceをAttemptへ記録する。選択漏れによるmissはLesson Proposalとbenchmark Caseで修正する。

公開FindingまたはResearcher Reference Corpus由来のCapsuleは、control planeにprovenanceを残しつつ、prospective Prompt Setからtarget identity、affected version、CVE、固有symbol、payload、patch情報を除去し、Oracle Leakage Gateとbenchmark promotionを通す。詳細は[ADR 0083](0083-gate-corpus-derived-knowledge-against-oracle-leakage.md)に記録する。
