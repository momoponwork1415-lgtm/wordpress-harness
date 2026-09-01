---
status: accepted
---

# Evolve Ledger events with versioned upcasters

記録済みのResearch Ledger eventは、schema変更のために書き換えない。各eventは安定した`kind`と正整数の`schema_version`を持ち、storage境界でruntime schemaにより検証した後、kind別の純粋なupcaster chainで現在のin-memory型へ変換する。

upcasterは外部I/O、clock、model、Campaign stateを参照せず、同じ入力から同じ出力を返す。過去versionごとのLedger fixtureを永続的なreplay compatibility testとして保持し、current projectionとCampaign decisionが意図せず変わらないことを確認する。

未知のkindまたは対応していない新しいversionを推測して読み飛ばさない。Campaignを変更せず`UnsupportedLedgerSchema`として安全側に停止する。projection checkpointはschema付きcacheであり、互換性がなければ破棄してLedger先頭から再構築する。
