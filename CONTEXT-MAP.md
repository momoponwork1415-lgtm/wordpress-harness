# Context Map

**3 contextは、それぞれの記録を所有し、versioned handoff contractで接続する。**

## Contexts

| Context / 用語集 | 所有する責務 |
| --- | --- |
| [Target Intelligence](docs/domain/target-intelligence/CONTEXT.md) | ecosystem観測、Target Proposal、人間のApproved Target Batch、dispatch |
| [Research](CONTEXT.md) | 一TargetのCampaign、Research Grant、両Human Review、Independent Validation、Finding、Coverage |
| [Human OS](docs/domain/human-os/CONTEXT.md) | runtime / human Verification、理解支援、Draft、submission staging、外部行動のauthorization |

## Relationships

| From → To | Handoff | 受け手の責務 |
| --- | --- | --- |
| Target Intelligence → Research | admitted Campaign Input | 固定sourceと条件からCampaignを開始する。選定policyは再評価しない |
| Research → Target Intelligence | Campaign Coverage Receipt | CandidateやFindingの詳細から切り離し、重複防止・resume・follow-upに使う |
| Research → Human OS | immutable Finding | source claimへfresh verificationの観測を追記する |
| Human OS → Research | Evidence Request | 具体的なproof gapを新しいResearch workとして扱う |

物理的に同じprocessやdatabaseを使っても、別contextのstorageや内部Moduleを直接参照・更新しない。raw model transcriptやwritable worker stateをhandoffにしない。

関係を図で見るには[Architecture](docs/ARCHITECTURE.md)、現在のModuleとhandoffの接続状況は[Codebase Guide](docs/CODEBASE-GUIDE.md)、oracle-freeな入力と独立Validationの制約は[Research Design](docs/RESEARCH-DESIGN.md)へ進む。
