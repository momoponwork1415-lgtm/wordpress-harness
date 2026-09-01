---
status: superseded
superseded_by: 0064
---

# Split Setup from network-isolated Research

Campaign実行をSetup phaseとResearch phaseへ分ける。Setupだけが許可list付きnetworkでplugin、WordPress、PHP、依存物、runtime imageを取得し、全入力をhash固定する。DiscoveryとVerificationではtarget、runtime、worker toolのoutbound networkを禁止し、model provider通信はsandbox外のModel Execution moduleだけが所有する。Research中の暗黙downloadまたはdependency updateを許可しない。

この決定の全面egress禁止は、pluginがFacebook等の外部serviceを通常機能として必要とする場合を扱えないため、[ADR 0064](0064-gate-live-plugin-egress-with-external-dependency-grants.md)で置き換えた。Setup/Research分離と暗黙download禁止は継続する。
