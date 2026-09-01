---
status: accepted
---

# Limit the core to one Target Snapshot campaign

このharnessの中核を、一つの固定済みWordPress pluginに対する`Target Snapshot → Hypothesis → independent Verification → Finding → next iteration`に限定する。target selection、programme eligibility、reporting、submissionを同じlifecycleへ含めると研究loopのinterfaceと成功条件が広がり、DiscoveryとVerificationの改善を独立に測れなくなるため、初期設計から除外する。複数Targetで再利用するLessonは保持するが、各Campaignの実行状態は混ぜない。
