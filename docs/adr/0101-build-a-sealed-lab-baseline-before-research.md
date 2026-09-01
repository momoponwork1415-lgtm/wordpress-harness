---
status: accepted
---

# Build a sealed Lab Baseline before Research

Source Understanding内部にLab Baseline Builderを置き、`establish(Target Snapshot, Runtime Profile, Canonical Configuration) -> ready | setup-blocked`の一つのinterfaceの背後へgVisor setup、dependency ordering、activation、health・smoke、snapshot、sealingを隠す。Runtime ProfileはWordPress core、PHP、database、web serverのartifactまたはOCI image digestとgVisor `runsc` build identityを固定し、Campaign中に`latest`を再解決しない。

`ready`にはfreshなWordPressとdatabase、全必須dependencyと主対象pluginのactivation、fatal error不在、frontend・admin・RESTの基本health、対象pluginの最小正常機能smoke成功を要求する。失敗は理由と証拠を持つセットアップ阻害の未完了Campaignとし、Intake Dispositionを変えず、hostまたはplain Dockerへfallbackしない。Verificationは完成済みbaselineからfresh siblingを作るだけとし、setupを再解釈しない。
