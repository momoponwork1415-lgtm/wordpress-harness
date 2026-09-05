# Documentation

主要文書はこのdirectory直下に置く。GitHubでは、まず次の四つだけを目的に応じて読む。

| Question | Canonical document |
| --- | --- |
| system全体、Module、artifact、Research loopを理解したい | [Harness Architecture](ARCHITECTURE.md) |
| 現在どこまで動き、どのcode/testがownerか知りたい | [Codebase Guide](CODEBASE-GUIDE.md) |
| 探索・Validation・costの判断原則を知りたい | [Research Design](RESEARCH-DESIGN.md) |
| capabilityをどの順番で閉じるか知りたい | [Roadmap](ROADMAP.md) |

通常のcode変更は **Codebase Guide -> [Module Design Index](design/README.md) -> owning Seam -> Behavior Test -> implementation** で進める。全ADRやresearch noteを通読しない。

## Repository map

```text
docs/
├── ARCHITECTURE.md          # 一つのwhole-system view
├── CODEBASE-GUIDE.md        # 現在の実装状態
├── RESEARCH-DESIGN.md       # research policy
├── ROADMAP.md               # 安定したcapability order
├── design/                  # ModuleごとのInterface
├── adr/                     # 現在有効なhard-to-reverse decision
├── experiments/             # 公開可能な実Target実測
├── research/                # 現在も再利用する外部調査note
├── domain/                  # context固有のdomain language
└── agents/                  # repository作業規則の補足
```

[Japanese Glossary](JAPANESE-GLOSSARY.md)は正式語の日本語対応、[References](REFERENCES.md)はharness全体の主要外部資料をまとめる。

## Source of truth

| Information | Canonical location |
| --- | --- |
| Mission / research policy | [Research Design](RESEARCH-DESIGN.md) |
| System / Module ownership | [Harness Architecture](ARCHITECTURE.md) |
| Module Interface / invariants / failure semantics | [Module Design Index](design/README.md)からowning Seam |
| Current implementation / source / Behavior Test | [Codebase Guide](CODEBASE-GUIDE.md) |
| Domain language | [Context Map](../CONTEXT-MAP.md) |
| Hard-to-reverse decision | [ADR index](adr/README.md) |
| Public-CVE execution evidence | [Experiments](experiments/README.md) |
| Active external evidence | [Research Notes](research/README.md) |
| Next finite work | GitHub Issues |
| Executable behavior | Behavior Tests |

## Keep documentation small

1. 新規docより既存のArchitecture、Research Design、Codebase Guide、owning Seamへの更新を優先する。
2. implementation statusはCodebase Guide、作業予定はIssue、実測はexperimentへ置く。
3. Architecture diagramは全体図一枚を基本とし、Module内の時系列が文章より明確な時だけ小さなMermaidを使う。
4. superseded ADR、完了計画、旧設計、過去snapshotはGit履歴から読み、現役docsへ残さない。
5. 採用済み結論だけのresearch noteは削除し、Research Design、Seam、ADRのいずれかへ結論を残す。
6. 同じ図、status table、ownership説明を複製しない。
