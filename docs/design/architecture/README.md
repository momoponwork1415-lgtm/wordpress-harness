# Architecture Views

このdirectoryは**図から全体像を掴むためのview**です。詳細仕様や現在の実装状態を複製しません。Module固有のcontractは[Design Documentation](../README.md)からowning Seamへ、現在地は[Codebase Guide](../../CODEBASE-GUIDE.md)へ進みます。

## Main views

通常は次の3つだけで十分です。

1. [Architecture Overview](architecture-overview.md) — system context、Research loop、trust zones
2. [Autonomous Research Loop](autonomous-research-loop.md) — Semantic Research、Depth Admission、Synthesis / Critic / missing-link反復
3. [Module Map](module-map.md) — 各Moduleが何を所有し、何を渡すか

## Specialized views

必要なテーマを変更するときだけ読みます。

- [Semantic Research, Breadth and Depth](breadth-depth-research-loop.md) — 通常研究、conditional Depth、将来のPRISM-like Breadth
- [Surface Map Architecture](surface-map-architecture.md) — Surface Mapの根拠状態と補助toolとしての境界
- [Prompt Responsibility Map](prompt-responsibility-map.md) — wp2shell / CDC PromptからHarnessへ移した責務

View同士で同じ仕様を完全に説明しません。図とSeamまたはaccepted ADRが衝突した場合は、Seam / ADRを正本としてviewを修正します。

探索policyの最初の正本は[Research Design Principles](../research-design-principles.md)です。Map-first、固定Strategy、Analysis Unitを探索境界とする旧記述と衝突する場合は、Research Design Principles、[ADR 0113](../../adr/0113-keep-finder-methods-free-behind-an-evidence-shell.md)、[ADR 0117](../../adr/0117-optimize-for-high-impact-semantic-recall.md)を優先します。

現在動くMap-first implementationの場所、status、Testは[Codebase Guide](../../CODEBASE-GUIDE.md)だけに置きます。
