---
status: accepted
---

# Limit Verification input

Verifierへ渡す入力を、Target Snapshot、Campaign scope、正規化したHypothesisに限定する。HypothesisはPermitted Attacker、security property、source route、unknowns、falsifierを含むが、Discovery conversation、confidence、priority、approach registry、scratch files、worker identityは渡さない。Verifierは提示routeを権威として受け入れず、固定sourceから到達性と原因を独立再導出してからExperimentを実行する。
