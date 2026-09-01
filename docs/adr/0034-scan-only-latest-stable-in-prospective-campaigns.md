---
status: accepted
---

# Scan only latest stable in prospective Campaigns

prospective Campaignは開始時点のlatest stable public plugin releaseだけをTarget Snapshotにする。Campaign中にnew releaseが公開されても同じSnapshotを更新せず、別Campaignとして扱う。historical vulnerable/patched releaseはDevelopment Cohort専用とし、prospective discoveryのidentity、priority、success metricsへ混ぜない。
