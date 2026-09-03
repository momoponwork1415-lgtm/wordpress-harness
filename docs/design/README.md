# Design Documentation

設計文書は、現在の実装を説明する場所ではなく、安定した責務・Interface・不変条件・failure semanticsを置く場所です。通常の変更では全設計書を読まず、変更対象を所有する文書だけを読みます。

## 入口

| 目的 | 読むもの |
| --- | --- |
| Researchの目的と判断原則を理解する | [Research Design Principles](research-design-principles.md) |
| system全体とtrust boundaryを理解する | [Architecture Overview](architecture/architecture-overview.md) |
| Semantic ResearchとDepth Escalationを理解する | [Autonomous Research Loop](architecture/autonomous-research-loop.md) |
| capabilityの実装順を確認する | [Roadmap](roadmap.md) |
| 現在どこまで動くか確認する | [Codebase Guide](../CODEBASE-GUIDE.md) |

## Moduleごとの正本

Moduleまたはsubsystemを変更するときは、対応するSeamを入口にします。Seamから必要なADR、Behavior Test、実装へ進みます。

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

Cross-module ownershipやIntegration Contractを変更するときだけ、[Module Architecture](module-architecture.md)を参照します。これは日常のreading pathではありません。

## Architecture views

図から理解したい場合は[Architecture Views](architecture/README.md)を使います。Viewは読みやすさのための投影であり、Module固有の詳細仕様を複製しません。

## Reference-only design

[architecture.md](architecture.md) は初期のTen-verb architectureを広く記録したbaselineです。現在のResearch policyと衝突する場合は、Research Design Principles、各Seam、accepted ADRを優先します。通常の変更でこの文書を通読または更新しません。内容が完全に歴史化した時点で`docs/history/`へ移します。

`development-harness.md`と`model-candidates.md`も、該当テーマを変更するときだけ読むreferenceです。現在のproduction statusはここへ書かず、[Codebase Guide](../CODEBASE-GUIDE.md)だけへ置きます。

## 書き方

- 新しい設計文書を作る前に、既存のowner Seamへ追記できないか確認する。
- 同じ判断をPrinciples、Seam、ADR、Architecture Viewへ全文複製しない。ADRは理由、Seamはcontract、Viewは理解用の図を持つ。
- implementation path、version、LOC、現在の未実装一覧、run結果はDesignへ置かない。
- 完了したGoalや旧設計は`docs/history/`、実Targetの実測は`docs/experiments/`、日付時点の評価は`docs/audits/`へ置く。
- 次に行う作業と受入条件はGitHub Issueへ置く。
