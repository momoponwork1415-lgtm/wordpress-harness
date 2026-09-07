# Documentation

主要文書はこのdirectory直下に置く。GitHubでは、まず次の入口だけを目的に応じて読む。

| Question | Canonical document |
| --- | --- |
| 図を追ってsystem全体の処理、artifact、状態、隔離境界を理解したい | [System Walkthrough](SYSTEM-WALKTHROUGH.md) |
| system全体、Module、artifact、Research loopを理解したい | [Harness Architecture](ARCHITECTURE.md) |
| 現在どこまで動き、どのcode/testがownerか知りたい | [Codebase Guide](CODEBASE-GUIDE.md) |
| 次に何を直すか、何が未完了か知りたい | [Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)（全体の入口）、[Issue #142](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/142)（agent-led Research）、[Issue #119](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/119)（保守性） |
| 探索・Validation・costの判断原則を知りたい | [Research Design](RESEARCH-DESIGN.md) |

通常のcode変更は **Codebase GuideのModule節 -> Behavior Test -> implementation** で進める。全ADRやKnowledgeを通読しない。

完成度はCodebase Guideの[Current capability](CODEBASE-GUIDE.md#current-capability)から読む。採用した設計、実装・Test、実対象での運用証拠を区別し、図やopen Issue件数を完成率へ換算しない。

## Repository map

```text
docs/
├── ARCHITECTURE.md          # 一つのwhole-system view
├── SYSTEM-WALKTHROUGH.md    # 六つの図を順に読むvisual atlas
├── CODEBASE-GUIDE.md        # 現在の実装状態
├── RESEARCH-DESIGN.md       # research policy
├── adr/                     # 現在有効なhard-to-reverse decision
├── knowledge/               # 普段は読まない外部根拠と公開実測
├── domain/                  # context固有のdomain language
├── agents/                  # repository作業規則の補足
└── diagrams/                # walkthroughから開くSVG assets
```

## Source of truth

| Information | Canonical location |
| --- | --- |
| Mission / research policy | [Research Design](RESEARCH-DESIGN.md) |
| System / Module ownership | [Harness Architecture](ARCHITECTURE.md) |
| Module Interface / invariants / failure semantics | [Codebase Guide](CODEBASE-GUIDE.md) |
| Current implementation / source / Behavior Test | [Codebase Guide](CODEBASE-GUIDE.md) |
| Domain language | [Context Map](../CONTEXT-MAP.md) |
| Hard-to-reverse decision | `docs/adr/` |
| Supporting evidence / reusable knowledge | [Knowledge](knowledge/) |
| Next finite work | GitHub Issues |
| Executable behavior | Behavior Tests |

## Keep documentation small

1. 新規docより既存のArchitecture、Research Design、Codebase Guideへの更新を優先する。
2. implementation statusはCodebase Guide、作業予定はIssue、公開可能な実測はKnowledgeへ置く。
3. Architecture diagramは所有境界、System Walkthroughは処理理解に限定し、同じ説明を増やさない。
4. superseded ADR、完了計画、旧設計、過去snapshotはGit履歴から読み、現役docsへ残さない。
5. Knowledgeは根拠と再利用可能な知見だけを持ち、採用済み結論はResearch Design、Codebase Guide、ADRのいずれかへ残す。
6. 同じ図、status table、ownership説明を複製しない。
