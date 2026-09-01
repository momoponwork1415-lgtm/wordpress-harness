---
status: accepted
---

# Evaluate with a metric vector

harness releaseとModel Profileは単一scoreまたはCVSS合計で順位付けせず、verified unique Findingsをimpact/premise band別に数え、false promotion、Coverage Closure、cost、wall time、run varianceを並べたmetric vectorで比較する。duplicateまたは低impact件数、高cost fan-outでscoreを稼げないようにし、採用時はroleのprecision/coverage requirementを満たすPareto frontierから選ぶ。
