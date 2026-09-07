# Documentation

全docを通読しない。目的に合う入口から読み、実装変更ではCodebase GuideのownerとBehavior Testへ進む。

| Question | Canonical document |
| --- | --- |
| 現在どこが動き、どこが未接続か | [Codebase Guide](CODEBASE-GUIDE.md) |
| systemのownershipとhandoff | [Architecture](ARCHITECTURE.md) |
| 一件のTargetの処理順 | [System Walkthrough](SYSTEM-WALKTHROUGH.md) |
| 探索、停止、Validationの原則 | [Research Design](RESEARCH-DESIGN.md) |
| domain language | [Context Map](../CONTEXT-MAP.md) |
| agent-led移行と診断coreの成功条件 | [ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md) · [ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md) |
| native探索状態の保存判断 | [ADR 0126](adr/0126-preserve-native-research-checkpoints-opaquely.md) |
| framework依存sourceを探索へ渡す判断 | [ADR 0128](adr/0128-provide-pinned-dependency-source-to-research.md) |
| 次の有限workと受入条件 | [GitHub Issues](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues) |

## Source of truth

| Information | Location |
| --- | --- |
| mission / research policy | [Research Design](RESEARCH-DESIGN.md) |
| context / Module ownership | [Architecture](ARCHITECTURE.md) |
| current implementation / seam / test / gap | [Codebase Guide](CODEBASE-GUIDE.md) |
| hard-to-reverse decision | `adr/` |
| public experiment / external comparison | `knowledge/` |
| executable behavior | Behavior Tests |

実装状態をArchitecture、ADR、Knowledgeへ複製しない。完了計画、旧設計、superseded ADRはGit履歴から読む。private Target、payload、transcript、未公開Findingはdocumentationへ入れない。
