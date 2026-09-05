---
status: accepted
---

# Bind source provenance to the Target File Manifest

Research内のsource identityは`TargetFileManifest`を正本とし、`Surface Map`をprovenanceの代理にしない。Target Intelligenceの`Canonical File Manifest`にある安定順のpath、原文bytes digest、sizeを、Researchが`Target Snapshot`を確定した直後にSource Understandingが損失なく一度だけ投影し、Target Snapshotへbindした不変artifactとしてCASへ置く。Researchは取得、正規化、受入policyを再実行しない。

新規Campaign Planは`TargetFileManifest` refを必須、`Surface Map` refを任意とする。ExplorationとVerificationはsource anchorをManifestに対して検査し、Map nodeまたはMap inventoryをcandidate受理、source read、Finding昇格の条件にしない。classificationとcoverageはSurface Map固有claimのままとし、既存`SurfaceMap.inventory`のpath、digest、sizeはv1互換の派生copyとして残すがsource identity判定には使わない。

既存Ledger recordとCAS artifactは書き換えない。新規PlanとManifest-boundな探索artifactはv2で書き、明示的に対応するv1 readerだけを残す。旧Planのreplayは元のSurface Mapが記録した`manifestDigest`から元のManifest artifactを読み、Target、ref、content digestを再検査する。元artifactが欠ける場合はMap inventoryからManifestを合成せず、worker起動前にtypedなlegacy replay failureとして停止する。supplied Mapのbinding不一致も黙ってMapなしへfallbackせず、別のMap-free Planを明示的に作るまで拒否する。
