# Design references

このharnessの設計参照資料は次の3件とする。URLはtracking parameterを除いたcanonical formで保存する。

1. [Google Cloud / Mandiant — Staying Ahead of Adversarial AI Through Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
2. [Anthropic — Defending Code Reference Harness: Best Practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
3. [Wordfence — Wordfence Argus: Moving Beyond Human Research Capability](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)

`wp2shell`のpromptは旧repositoryの原型であり、上記3件と同列の設計参照資料ではない。新設計ではその系譜を分析対象として扱う。

## Supporting security-method references

white-box review、static analysis、検証手法の個別判断では、OWASP、NIST、OASIS、公式tool documentation等の一次資料を補助根拠として使う。これらは上記3件と同列のagentic harness設計参照資料ではなく、外部資料が直接支持する範囲とharness固有の推論を分けて記録する。

- [White-box Surface Mapping security reference](research/white-box-surface-mapping-security-reference.md)
- [Harness source-mapping implementation patterns](research/harness-source-mapping-patterns.md)
- [Surface Map context retrieval bottleneck](research/surface-map-context-retrieval-bottleneck.md)
- [Evidence-guided Finder loop design evidence](research/evidence-guided-finder-loop-design-evidence.md)
- [Free-reasoning Finder and evidence-shell harness references](research/free-reasoning-evidence-shell-harness-references.md)
- [Agentic harness reference inventory](research/agentic-harness-reference-inventory.md)
- [Dutafi — How I Structure My WordPress Vulnerability Hunting Workflow](https://medium.com/@ductai126/how-i-structure-my-wordpress-vulnerability-hunting-workflow-0a236760096f) — Semgrep-first実務の成功範囲と、wrapper・state・second-order・multi-stepに関する著者自身の限界分析

Anthropicの公開best practicesをこのrepositoryでどう適用するかは[調査設計原則](design/research-design-principles.md)を正本とする。原文のsystem mappingをSurface Map必須化へ読み替えず、raw-source first、Discovery/Verification分離、run間union、missing-primitive follow-up、検証済みFindingのrule化として採用する。
