---
status: accepted
---

# Render one versioned Prompt Set

worker promptはRole Prompt、Campaign Policy、Work Assignment、selected Knowledgeのversioned layerから決定的にrenderし、一つのhash固定入力としてModel Executionへ渡す。scope、filesystem、network、budgetはrunnerでも強制し、promptはrole、goal、evidence、closureへ集中させる。実行中にPrompt SetまたはAssignmentを変更する場合は同じAttemptを上書きせず、新しいAttemptとしてLedgerへ記録する。
