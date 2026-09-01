---
status: accepted
---

# Admit only causal Boundary Pairs

Development Caseは、vulnerable Target SnapshotでWitnessが成立し、actual patched Target Snapshotで同じCausal IdentityのWitnessが消え、benign-function controlが両側の通常機能を確認するBoundary Pairとしてのみadmitする。version番号またはdiffの存在だけをoracleにせず、positive、same-cause negative、non-destructive controlを人間が再現してhash固定する。
