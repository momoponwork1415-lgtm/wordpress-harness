---
status: accepted
---

# Turn each Finding into variant and rule work

Finding確定時に、そのCausal Identityを使った同Target内のvariant Focus Areaと、deterministic static rule候補、regression fixture候補、Lesson Proposalを次iterationへ必ず作る。ruleは近い構文variantを安価に拾うfloorであり、cross-file reasoningを置き換えない。patch生成はharness中核scopeに含めず、ruleとLessonのglobal昇格はbenchmark gateを必要とする。
