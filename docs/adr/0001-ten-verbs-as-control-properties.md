---
status: accepted
---

# Treat the ten verbs as control properties

Argusの10動詞を10段の固定pipelineや10個のmoduleには対応させず、Campaign全体と各反復が満たす観測可能なcontrol propertyとして採用する。固定pipelineは対象ごとの調査方法を狭め、動詞ごとのmoduleは浅いpass-throughを増やす一方、control propertyなら同じ小さなorchestration interfaceの内側で対象・仮説・証拠に応じて実装を変えられるためである。
