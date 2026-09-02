# アーキテクチャ図（Architecture Views）

コードの詳細を追う前に、目的別の図から全体像を把握するための入口である。設計判断の正本は一階層上の各`*-seam.md`と`module-architecture.md`に置き、このfolderでは同じ設計を読みやすい複数のviewへ分ける。

1. [Module Map](module-map.md) — 各Moduleの機能、入力、出力、現在地
2. [アーキテクチャ概要](architecture-overview.md) — system context、探索loop、trust zone
3. [探索エージェント構成](exploration-agent-architecture.md) — Surface Map、Focus、3並列、予算付きsource追跡、Verification、Model Profile差替え
4. [探索アーキテクチャ詳細ガイド](../../visuals/exploration-architecture.html) — 実装fileまで一画面ずつ辿るHTML版
5. [Prompt責務の分離](prompt-responsibility-map.md) — wp2shell/CDC Promptからcontrol planeへ移した責務

図中では実装済み・一部実装・設計のみを区別する。図と正本が矛盾した場合は正本を優先し、図を同じ変更で更新する。

旧`wp2shell` Promptから現在のModuleへ責務を移した根拠は、[wp2shell由来Promptの責務分解](../../research/wp2shell-prompt-decomposition.md)にまとめる。これはarchitecture viewではなく、legacy設計意図のtraceability noteである。

固定Analysis Unitから予算付きsource追跡へ移るaccepted designは、[Evidence-guided Finder loop](../evidence-guided-finder-loop.md)と[ADR 0112](../../adr/0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md)を正本とする。探索図の灰色部分は未実装の到達形を表す。
