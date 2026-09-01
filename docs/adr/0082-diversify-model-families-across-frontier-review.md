---
status: accepted
---

# Diversify model families across Frontier review

Milestone 2以降、eligibleなModel Profileが複数ある場合は、Frontier HypothesisのFinder、第一Verifier、第二Verifier、Skepticを可能な限り異なるmodel familyへ割り当てる。これは一つのmodel familyに共通する見落とし、もっともらしい誤推論、verifier gamingが全段へ相関するriskを減らすためである。

Model familyの多様性はevidenceの代わりではなく、同じWitness、Causal Control、Evidence Route gateを全Attemptへ適用する。provider outage、policy、capability、budgetにより分離できない場合は同一familyを使えるが、`Model Separation Exception`として理由をLedgerへ記録し、Frontier resultの評価sliceを分ける。Milestone 1のOpus-only bootstrapは明示的な例外である。

通常のPrimitiveまたはCoverage workへ常時異種modelを強制せず、M2 benchmarkでrole別能力とcostを比較してModel Profileを選ぶ。
