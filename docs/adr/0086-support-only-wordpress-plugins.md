---
status: accepted
---

# Support only WordPress plugins

このharnessはWordPress.org配布または正規入手したpremium WordPress pluginだけをTargetとし、themeとWordPress Coreは非対応・計画外とする。Wordfence programmeのasset scopeとharnessの技術的対象を同一視せず、使わないTarget分岐をcontract、Source Mapping、検証環境へ先行導入しない。将来の発展候補はWordPress Coreへの拡張ではなく、WordPress外のホワイトボックス・バグバウンティを扱う別productである。その場合も現行interfaceの汎用化を前提とせず、対象言語、build system、runtime、programme policyに合わせて独立に設計する。
