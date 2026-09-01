---
status: accepted
---

# Run Witness and Causal Control in sibling Labs

一つのVerificationにおけるWitnessとCausal Controlは、同じsealed Lab Baselineから別々に生成したfresh sibling Labで実行する。Witness実行後のdatabase、filesystem、cache、session、browser、external-service stateをControlへ引き継がない。

両LabはTarget Snapshot、WordPress/PHP/database image、Canonical Configurationまたは同じConfiguration Variant、seed data、clock policy、External Dependency Grant、Experiment adapter versionを共有する。差分はExperiment Planで宣言した一つのcausal factorだけとし、各Labのbaseline digestとeffective configuration digestをevidenceへ記録する。

WitnessとControlの実行順、provider latency、nonce衝突が判定へ影響しないよう、固有canaryを使用し、mechanism固有のtyped observationを比較する。同じbaselineから二つのLabを作れない場合、同一Labのresetを同等と推測せずVerificationを`Blocked`にする。

live external serviceが共有stateを持ち完全なsibling条件を壊す場合は`non-hermetic`を記録し、service stateの分離またはrecord/replayを追加するまで自動Finding昇格を止める。
