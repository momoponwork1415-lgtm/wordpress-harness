# Design Documentation

設計文書には、安定した責務・Interface・不変条件・failure semanticsだけを置く。現在の実装状態は[Codebase Guide](../CODEBASE-GUIDE.md)だけを正本とする。

## 入口

| 目的 | 読むもの |
| --- | --- |
| Researchの目的と判断原則 | [Research Design Principles](research-design-principles.md) |
| system全体とtrust boundary | [Architecture Overview](architecture/architecture-overview.md) |
| Semantic Research / Depth Escalation | [Autonomous Research Loop](architecture/autonomous-research-loop.md) |
| Semantic / Depth / Breadthの関係 | [Semantic Research, Breadth and Depth](architecture/breadth-depth-research-loop.md) |
| capabilityの実装順 | [Roadmap](roadmap.md) |
| 現在の実装状態 | [Codebase Guide](../CODEBASE-GUIDE.md) |

## Moduleごとの正本

| Owner / subsystem | Canonical design |
| --- | --- |
| Campaign Control | [Campaign Execution Seam](campaign-execution-seam.md) |
| Campaign setup / lab baseline | [Campaign Setup Seam](campaign-setup-seam.md) |
| Exploration | [Exploration Seam](exploration-seam.md) |
| Source Understanding / Surface Map | [Source Mapping Seam](source-mapping-seam.md) |
| PHP Program Index | [PHP Program Index Seam](php-program-index-seam.md) |
| Verification | [Verification Seam](verification-seam.md) |
| Model Execution | [Model Execution Seam](model-execution-seam.md) |
| Target intake | [Target Intake Seam](target-intake-seam.md) |

cross-moduleの関係は[Module Map](architecture/module-map.md)で確認し、詳細は各Seamへ置く。巨大な中央設計書は作らない。

## 書き方

- 新規docより既存のowner Seamへの追記を優先する。
- ADRは理由、Seamはcontract、Architecture Viewは理解用の図だけを持つ。
- implementation path、version、LOC、現在の未実装一覧、run結果はDesignへ置かない。
- 旧設計や完了計画を保存用Markdownとして残さない。Git履歴を使う。
- 次に行う作業と受入条件はGitHub Issueへ置く。
