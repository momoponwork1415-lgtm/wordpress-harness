---
status: accepted
---

# Treat effort as provider-specific

effortまたはreasoning設定をprovider間で共通の尺度へ正規化しない。初期Model Profileは`provider-default`を明示し、実戦Campaignで特定roleのcost、latency、品質がボトルネックとなった場合だけ、provider固有の隣接設定を小さな固定条件で比較する。effortを公開しないmodelは固定値として扱い、採用判断は設定名ではなく実測cost、latency、品質に基づける。
