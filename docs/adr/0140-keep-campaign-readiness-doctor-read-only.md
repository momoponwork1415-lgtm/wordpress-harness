---
status: accepted
---

# Keep Campaign readiness Doctor read-only

Campaign readiness Doctorは、各preflightを`ready`、`blocked`または`unknown`として説明するだけにし、修復、login、観測更新、Campaign mutationまたはlaunchを行わない。観測不能を`blocked`へ丸めると人間が直すべき既知の不一致と現在値が分からない状態を区別できず、`ready`へ丸めるとquotaや認証状態を推測してmodel実行へ進むためである。overall statusは一件でも既知のblockがあれば`blocked`、blockがなく一件でも観測不能なら`unknown`、全checkが通った場合だけ`ready`とする。

Doctorは既存のsealed source、prompt、launcher observation / receipt、resume Checkpointをread-onlyに照合する。missing databaseは既存parentのaccessだけを確認し、scratch、receipt、database、private artifactを作らない。provider executable versionだけはlocalのexact pinned imageを`pull=never`、`runsc`、`network=none`、read-only filesystem、credential / Target / prompt mountなしで一時実行し、`--version`以外を渡さない。これはmodel invocationではなく、終了後にcontainerを残さないbounded probeである。

代償としてDoctorは環境をreadyに変えず、stale observation、missing scratch、login切れや壊れたartifactの解決をoperatorへ返す。またprovider version probeにはDocker daemon上の一時container実行が必要だが、providerをhost processで動かすfallbackやnetwork付きprobeは許可しない。
