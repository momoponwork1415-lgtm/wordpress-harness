# Module Design Index

このdirectoryにはModule固有のInterface、不変条件、failure semantics、Behavior Test surfaceだけを置く。system全体は[Harness Architecture](../ARCHITECTURE.md)、research policyは[Research Design](../RESEARCH-DESIGN.md)、現在の実装は[Codebase Guide](../CODEBASE-GUIDE.md)を先に読む。

## Target Intelligence

| Module / Seam | Owns |
| --- | --- |
| [Target Intake](target-intake-seam.md) | untrusted sourceの受入、canonical identity、Target Intake Packet |

## Research

| Module / Seam | Owns |
| --- | --- |
| [Campaign Control](campaign-execution-seam.md) | lifecycle、finite work、budget、terminal、replay |
| [Source Understanding](source-mapping-seam.md) | source inventory、optional Surface Map、source query |
| [PHP Program Index](php-program-index-seam.md) | pinned parser helperから作るmanifest-bound PHP index |
| [Exploration](exploration-seam.md) | research thesis、Hypothesis、Fragment、Depth、closure |
| [Validation](validation-seam.md) | independent source review、Synthesis、Review Packet |
| [Model Execution](model-execution-seam.md) | provider/process/tool binding、supervision、terminal result |

Research RecordはCampaign Controlから使うappend-only internal Moduleであり、単独のpublic Seam文書を持たない。artifactとreplayのcontractは[Campaign Control](campaign-execution-seam.md)を正本とする。

## Human OS

| Module / Seam | Owns |
| --- | --- |
| [Human Verification](human-verification-seam.md) | queue、human disposition、Finding、Evidence Request、外部承認 |
| [Human Verification Environment](campaign-setup-seam.md) | fresh disposable environment、setup receipt、isolation gate |
| [Legacy Verification compatibility](verification-seam.md) | 旧Ledgerと旧automated Findingのread-only replay |

## Editing rule

- ArchitectureはcontextとModule関係、Seamは一つのModuleのInterfaceだけを説明する。
- 現在の実装path、version、完成度、未実装一覧はCodebase Guideへ置く。
- hard-to-reverseな判断理由だけを[ADR](../adr/README.md)へ置く。
- 次の作業と受入条件はGitHub Issuesへ置く。
- 同じflow、状態表、ownership説明を複数のSeamへ複製しない。
