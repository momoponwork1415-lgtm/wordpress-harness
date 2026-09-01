---
status: accepted
---

# Blind benchmark workers to Case roles

Development CohortとSealed Evaluation Cohortのworker-visible viewから、vulnerable、patched、benign、expected outcome、CVE、Case ID等のsemantic roleを除く。directory、manifest、prompt、environmentにはneutral Snapshot IDだけを示し、roleとoracleの対応はAttempt終了後のgraderだけが所有する。role labelを変えて同じworker-visible inputを別Caseとして数えない。
