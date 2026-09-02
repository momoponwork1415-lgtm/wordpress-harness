---
status: accepted
---

# Treat the ten verbs as control properties

Argusの10動詞を10段の固定pipelineや10個のmoduleには対応させず、Campaign全体と各反復が満たす観測可能なcontrol propertyとして採用する。固定pipelineは対象ごとの調査方法を狭め、動詞ごとのmoduleは浅いpass-throughを増やす一方、control propertyなら同じ小さなorchestration interfaceの内側で対象・仮説・証拠に応じて実装を変えられるためである。

この10語はプロジェクト最上位の設計原則であり、control propertyは原則を実装・検査可能にする具体化の形式である。新しいmodule、policy、artifactは、どの原則へ寄与し、何を観測すれば成立を確認できるかを説明できなければならない。

10語の意味、Anthropic Defending Code Reference Harnessの運用原則、DepthとBreadthの関係、設計衝突時の優先規則は[調査設計原則](../design/research-design-principles.md)を正本とする。
