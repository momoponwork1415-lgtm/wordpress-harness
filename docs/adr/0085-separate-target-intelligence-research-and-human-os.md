---
status: accepted
---

# Separate Target Intelligence, Research, and Human OS

systemを`Target Intelligence -> Research -> Human OS`の三contextに分ける。Target Intelligenceは観測、eligibility、ranking、acquisitionを所有してOracle Factを除いたTarget Intake Packetを渡し、Researchは探索だけでなく独立Verification、記録、優先順位付け、反復を所有してHuman Review Packetを渡し、Human OSは独立した人間reviewと外部行動の判断を所有する。

Human OSはResearch Ledgerの事実またはFindingを編集しない。不足があればEvidence Requestとして新しいResearch workを作り、判断はpacket digestへ結び付いたappend-only recordとして残す。Human ConfirmationとExternal Action Authorizationを分けることで、技術的な再現成功を外部送信の暗黙許可にしない。
