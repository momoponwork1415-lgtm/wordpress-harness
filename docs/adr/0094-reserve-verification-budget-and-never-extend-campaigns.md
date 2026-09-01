---
status: accepted
---

# Reserve verification budget and never extend Campaigns

Campaignの予算枠はwall time、Attempt数、Work Wave数、concurrencyをhard ceilingとし、provider usage、token、subscriptionの推定金額は取得可能なtelemetryとして扱う。開始時に少なくとも一つの上位Hypothesisをfresh Verifier、成立証拠、sibling因果対照実験、反証レビューまで閉じられる予算を予約し、Discoveryが消費できないようにする。同じCampaignの予算を自動延長せず、未解決gapを続ける場合は他Targetと再比較し、選定された時だけpredecessorとgap refsを持つ後続Campaignを新規作成する。
