---
status: accepted
---

# Bootstrap prospective Research with manual Target intake

Research capabilityを自動Target Selectionより先に成立させる順序は維持し、Milestone 2ではoperatorが一つの最新安定版pluginを選んで手動対象投入し、readyなTarget Intake PacketからCampaignを明示的に開始する。Campaign開始後のResearchは自律実行するが、候補queue、feed-driven ranking、次Targetの自動起動はMilestone 3まで行わない。

手動入力はsource、version、正規入手provenance、必要な構成と環境依存だけを許可し、CVE、advisory、疑わしいfile・symbol・parameter、期待するvulnerability classまたはrouteを拒否する。受入preflightは`ready | deferred | rejected`を理由付きで記録し、解消可能なdependency・runtime・設定・source不足をdeferred、plugin scope・provenance・integrity・latest-stable・oracle-free policy違反をrejectedとする。ready以外ではResearch Campaignを作らず、黙ってskipまたは失敗を「調査済み」にしない。

現在のResearch実装が直接受け取るcaller作成済み`TargetSnapshotRef`は最初のLedger sliceに限る暫定境界であり、prospective Campaignの安全な受入契約ではない。Milestone 2前に、手動対象投入がTarget Intake Packetを生成し、ResearchがそこからTarget Snapshotを固定するversioned seamへ移行する。
