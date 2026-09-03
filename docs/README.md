# Documentation

このrepositoryの文書は**順番に全部読むものではありません**。目的から正本へ直接進みます。同じ事実を複数文書へコピーせず、現在地・設計・判断理由・実測を別々に管理します。

## 目的別の入口

| やりたいこと | 最初に読むもの | 次に読むもの |
| --- | --- | --- |
| Researchの目的と判断原則を理解する | [Research Design Principles](design/research-design-principles.md) | [Autonomous Research Loop](design/architecture/autonomous-research-loop.md) |
| system全体を理解する | [Architecture Overview](design/architecture/architecture-overview.md) | [Module Map](design/architecture/module-map.md) |
| 現在どこまで動くか知る | [Codebase Guide](CODEBASE-GUIDE.md) | 対象ModuleのSeam |
| あるModuleを変更する | [Design Documentation](design/README.md) | 対象Seam → Behavior Test → code |
| 探索policyを変更する | [Research Design Principles](design/research-design-principles.md) | [Exploration Seam](design/exploration-seam.md) → relevant ADR |
| 実Targetでの成否を見る | [Experiments](experiments/README.md) | 日付付きexperiment |
| 日付時点の完成度を見る | [Audits](audits/README.md) | 最新のdated audit |
| なぜその判断になったか知る | [ADR index](adr/README.md) | 必要なADRだけ |
| 外部資料や比較根拠を調べる | [Research Notes](research/README.md) | 該当note |
| 旧設計や完了Goalを調べる | [History](history/README.md) | 必要なsnapshotだけ |

通常のcode変更では、**Codebase Guide → owning Seam → Behavior Test → implementation**の4点で十分です。全ADR、`module-architecture.md`、research noteを通読しません。

## Source of truth

| 種類 | 正本 | 置かないもの |
| --- | --- | --- |
| Mission / research policy | `docs/design/research-design-principles.md` | 現在の実装状態 |
| System / Module design | `docs/design/` のowning Seam | run結果、LOC、Issue順 |
| Current implementation | `docs/CODEBASE-GUIDE.md` | 長期設計判断の理由 |
| Domain language | `CONTEXT.md`、`docs/domain/` | implementation detail |
| Hard-to-reverse decision | `docs/adr/` | 現在地の説明 |
| Public-CVE execution evidence | `docs/experiments/` | 将来の仕様 |
| Dated completeness snapshot | `docs/audits/` | living status |
| External evidence / comparison | `docs/research/` | production仕様 |
| Completed / superseded design | `docs/history/` | active design |
| Next finite work | GitHub Issues | design diary |
| Executable behavior | Behavior Tests | 設計理由の長文 |

## 文書を追加する前に

1. 既存のowner Seamへ追記できないか確認する。
2. implementation statusならCodebase Guide、作業予定ならIssue、実測ならexperiment/auditへ置く。
3. 判断理由だけが必要ならADRにするが、hard-to-reverseでない内部判断にADRを作らない。
4. 完了済み計画や旧設計をactive docsへ残さず、必要なら`history/`へ凍結する。
5. 同じ図、status table、説明を別文書へ複製しない。

## Repository-specific docs

- [Design Documentation](design/README.md) — stable designのowner別index
- [Architecture Views](design/architecture/README.md) — GitHubで把握するための小さい図
- [Japanese Glossary](JAPANESE-GLOSSARY.md) — 正式語の日本語対応
- [References](REFERENCES.md) — harness全体の主要design references

`docs/design/architecture.md`は初期Ten-verb architectureの広いbaselineであり、通常のreading pathではありません。現在のResearch policyと衝突する場合はResearch Design Principles、owning Seam、accepted ADRを優先します。完全に歴史化した段階で`docs/history/`へ移します。
