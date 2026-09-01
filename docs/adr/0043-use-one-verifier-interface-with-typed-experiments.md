---
status: accepted
---

# Use one Verifier interface with typed Experiments

外部seamは`Verifier.verify(Hypothesis, TargetSnapshot) -> VerificationRecord`の一つに保ち、implementationがHypothesisのmechanismに応じてtyped Experiment adapterを選ぶ。SQL injection、XSS、file operation、authorization transition、code execution等で異なるWitnessとCausal Controlをgenericな`success`またはproof文字列へ平坦化しない。共通化するのはlifecycle、snapshot binding、provenance、outcomeだけとする。
