# Design Baseline v0.1

Status: accepted, 2026-09-01

このbaselineは、実装開始時点の設計判断を固定する索引である。文書を複製せず、正本への参照と変更規則だけを持つ。

## Baseline

- domain ownership: [Context Map](../../CONTEXT-MAP.md)
- Research language: [Research context](../../CONTEXT.md)
- Target selection language: [Target Intelligence context](../domain/target-intelligence/CONTEXT.md)
- human decision language: [Human OS context](../domain/human-os/CONTEXT.md)
- system design: [Ten-verb architecture](architecture.md)
- delivery order: [Capability-first roadmap](roadmap.md)
- model candidates: [Model candidates](model-candidates.md)
- design sources: [three canonical references](../REFERENCES.md)
- engineering rules: [AGENTS.md](../../AGENTS.md)
- accepted decisions: ADR 0001 through ADR 0085。ただしADR 0026はADR 0064にsupersedeされている。

## Change rule

実装中に得た証拠で設計は改善してよい。accepted ADRの本文を書き換えて判断履歴を消さず、hard-to-reverseな変更は新しいADRでsupersedeし、次のbaselineで索引を更新する。typo、リンク修正、意味を変えない明確化はbaseline versionを上げない。
