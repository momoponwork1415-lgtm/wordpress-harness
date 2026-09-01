---
status: accepted
---

# Fix the canonical Plugin Basename

WordPress.org版のcanonical install directoryはofficial slugへ固定し、premium版はvendor配布provenanceまたは手動対象投入で明示する。premium Plugin Identityのvendor/product、archive basename、Plugin Nameからdirectoryを自動生成しない。canonical install directoryと検証済みmain plugin fileを結合したPlugin BasenameをTarget Intake PacketとTarget Snapshotへ固定し、Campaign setupはそのlogical locationを再現する。

別directory名でのみ成立する調査はcanonical Target Snapshotを変更せず、alternate directory、effective Plugin Basename、具体的根拠を持つConfiguration Variantとして扱う。Witness、Causal Control、Findingは使用したVariant digestへ結び付けるため、配置依存の挙動を通常構成のFindingへ暗黙に混ぜない。
