---
status: accepted
---

# Build evidence-graded immutable Surface Map revisions

Source MappingはPHP Program Indexを骨格に、JavaScript、template、SQL、configuration、bundled vendor等の関連assetを結ぶ不変のSurface Map revisionを作る。nodeとrelationは固定source anchorからstable identityを持ち、根拠状態を`observed`、`inferred`、未解決（`unknown`）に分ける。modelはobserved factを上書きできず、動的関係を確定できない場合は不足証拠を持つunknown gapとして残す。

`unknown`は[ADR 0077](0077-represent-each-hypothesis-with-an-evidence-route.md)で固定したEvidence Route schemaとの共通code identifierであり、日本語では「未解決」と呼ぶ。

Mapperへは決定的に選んだgraph近傍とsource sliceから文脈を与え、追加readは理由付きContext Requestとして次revisionへ記録する。WordPress Coreとframework知識は版付きKnowledge Capsule由来のinferred evidenceとし、Target固有sourceと混同しない。全repository投入や推測edgeより複雑になるが、model推論の事実化、dynamic PHPの誤接続、非PHP・vendor surfaceの黙示的除外、再実行ごとの地図identity driftを防ぐ。
