---
status: accepted
---

# Prove research capability before automating target selection

Wordfence Intelligence APIによる定期取得とTarget選定は重要なupstream contextだが、最初に実装しない。固定したDevelopment Boundary Pairへ手動でTarget Snapshotを投入し、探索、独立検証、記録、反復の能力を測定可能にしてから自動選定を追加する。

roadmapを次の順に固定する。

1. Milestone 1: Opus、gVisor、Brizy Boundary Pairで一つのclosed research loopを完成させる
2. Milestone 2: 四つのDevelopment Case、四つのmodel candidate、複数runで探索・検証能力を改善し、varianceを測る
3. Milestone 3: Wordfence Intelligence APIを使う独立`Target Intelligence` contextを追加する

Milestone 3までTargetはCLIから明示的にimportする。Target Intelligenceは定期取得したraw observation、eligibility、ranking、acquisitionを所有し、CampaignRunnerへsanitized Target Candidateだけを渡す。既知CVE、advisory、vulnerable/patched roleなどのoracleはprospective Discoveryへ渡さない。

Target IntelligenceをCampaign lifecycle、Research Ledger、Exploration Queueへ混ぜない。selection sourceの停止またはpolicy変更が、進行中Campaignの固定identityと研究結果を変更しないようにする。
