# Documentation

主要文書はこのdirectory直下に置く。GitHubでは、まず次の三つだけを目的に応じて読む。

| Question | Canonical document |
| --- | --- |
| system全体、Module、artifact、Research loopを理解したい | [Harness Architecture](ARCHITECTURE.md) |
| 現在どこまで動き、どのcode/testがownerか知りたい | [Codebase Guide](CODEBASE-GUIDE.md) |
| 探索・Validation・costの判断原則を知りたい | [Research Design](RESEARCH-DESIGN.md) |

通常のcode変更は **Codebase Guide -> [Module Design Index](design/README.md) -> owning Seam -> Behavior Test -> implementation** で進める。全ADRやKnowledgeを通読しない。

## Repository map

```text
docs/
├── ARCHITECTURE.md          # 一つのwhole-system view
├── CODEBASE-GUIDE.md        # 現在の実装状態
├── RESEARCH-DESIGN.md       # research policy
├── design/                  # ModuleごとのInterface
├── adr/                     # 現在有効なhard-to-reverse decision
├── knowledge/               # 普段は読まない外部根拠と公開実測
├── domain/                  # context固有のdomain language
└── agents/                  # repository作業規則の補足
```

[Japanese Glossary](JAPANESE-GLOSSARY.md)は正式語の日本語対応である。

## Source of truth

| Information | Canonical location |
| --- | --- |
| Mission / research policy | [Research Design](RESEARCH-DESIGN.md) |
| System / Module ownership | [Harness Architecture](ARCHITECTURE.md) |
| Module Interface / invariants / failure semantics | [Module Design Index](design/README.md)からowning Seam |
| Current implementation / source / Behavior Test | [Codebase Guide](CODEBASE-GUIDE.md) |
| Domain language | [Context Map](../CONTEXT-MAP.md) |
| Hard-to-reverse decision | [ADR index](adr/README.md) |
| Supporting evidence / reusable knowledge | [Knowledge](knowledge/) |
| Next finite work | GitHub Issues |
| Executable behavior | Behavior Tests |

## Keep documentation small

1. 新規docより既存のArchitecture、Research Design、Codebase Guide、owning Seamへの更新を優先する。
2. implementation statusはCodebase Guide、作業予定はIssue、実測はexperimentへ置く。
3. Architecture diagramは全体図一枚を基本とし、Module内の時系列が文章より明確な時だけ小さなMermaidを使う。
4. superseded ADR、完了計画、旧設計、過去snapshotはGit履歴から読み、現役docsへ残さない。
5. Knowledgeは根拠と再利用可能な知見だけを持ち、採用済み結論はResearch Design、Seam、ADRのいずれかへ残す。
6. 同じ図、status table、ownership説明を複製しない。
