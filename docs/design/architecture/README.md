# Architecture Views

全体像を把握するための少数の図だけを置く。Module固有の仕様は各Seamを正本とする。

1. [Architecture Overview](architecture-overview.md) — Target選定からHuman Verificationと外部承認までのwhole-system view
2. [Autonomous Research Loop](autonomous-research-loop.md) — Semantic Research、Depth Admission、Synthesis、Critic、missing-link反復
3. [Module Map](module-map.md) — Module ownershipとartifact flow
4. [Semantic Research, Breadth and Depth](breadth-depth-research-loop.md) — 通常研究、conditional Depth、将来Breadthの関係

現在の実装状態は[Codebase Guide](../../CODEBASE-GUIDE.md)、探索判断の正本は[Research Design Principles](../research-design-principles.md)とaccepted ADRである。ViewへSeamの詳細仕様や現在地を複製しない。

Architecture Overviewの編集可能な正本は
[harness-whole-system.drawio](harness-whole-system.drawio)である。変更時は同じ内容の
[SVG view](harness-whole-system.svg)も更新し、Markdownから直接閲覧できる状態を保つ。
