# Documentation

このrepositoryの文書は**必要な正本だけを読む**。同じ事実を複数文書へコピーせず、設計・現在地・判断理由・実測を分離する。

## 目的別の入口

| やりたいこと | 最初に読むもの | 次に読むもの |
| --- | --- | --- |
| Researchの目的と判断原則を理解する | [Research Design Principles](design/research-design-principles.md) | [Autonomous Research Loop](design/architecture/autonomous-research-loop.md) |
| system全体を理解する | [Architecture Overview](design/architecture/architecture-overview.md) | [Module Map](design/architecture/module-map.md) |
| 現在どこまで動くか知る | [Codebase Guide](CODEBASE-GUIDE.md) | 対象ModuleのSeam |
| あるModuleを変更する | [Design Documentation](design/README.md) | owning Seam → Behavior Test → code |
| 探索policyを変更する | [Research Design Principles](design/research-design-principles.md) | [Exploration Seam](design/exploration-seam.md) → relevant ADR |
| 実Targetでの成否を見る | [Experiments](experiments/README.md) | 日付付きexperiment |
| なぜその判断になったか知る | [ADR index](adr/README.md) | 必要なADRだけ |
| 現役の外部資料・benchmark根拠を見る | [Research Notes](research/README.md) | 該当note |

通常のcode変更は **Codebase Guide → owning Seam → Behavior Test → implementation** で十分である。全ADRやresearch noteを通読しない。

## Source of truth

| 種類 | 正本 |
| --- | --- |
| Mission / research policy | `docs/design/research-design-principles.md` |
| System overview | `docs/design/architecture/architecture-overview.md` |
| Module ownership | `docs/design/architecture/module-map.md` + owning Seam |
| Current implementation | `docs/CODEBASE-GUIDE.md` |
| Domain language | `CONTEXT.md`、`docs/domain/` |
| Hard-to-reverse decision | `docs/adr/` |
| Public-CVE execution evidence | `docs/experiments/` |
| External evidence / active benchmark reference | `docs/research/` |
| Next finite work | GitHub Issues |
| Executable behavior | Behavior Tests |

## 文書を増やさない規則

1. 新規docより既存のowner Seamへの追記を優先する。
2. implementation statusはCodebase Guide、作業予定はIssue、実測はexperimentへ置く。
3. hard-to-reverseな判断だけADRにする。
4. 完了計画・旧設計・過去snapshotはrepo内へ保存用Markdownとして残さない。必要ならGit履歴から読む。
5. 採用済み結論だけのresearch noteは削除し、正本またはADRへ結論を残す。
6. 同じ図、status table、説明を別文書へ複製しない。

## Repository-specific docs

- [Design Documentation](design/README.md) — owner別のdesign index
- [Architecture Views](design/architecture/README.md) — 全体を把握するための少数の図
- [Japanese Glossary](JAPANESE-GLOSSARY.md) — 正式語の日本語対応
- [References](REFERENCES.md) — harness全体の主要design references
