# Context Map

**3 contextは、それぞれの記録を所有し、versioned handoff contractで接続する。**

## Contexts

| Context / 用語集 | 所有する責務 |
| --- | --- |
| [Target Intelligence](docs/domain/target-intelligence/CONTEXT.md) | ecosystem観測、Target Proposal、人間のApproved Target Batch、dispatch |
| [Research](CONTEXT.md) | 一Targetの自律Research Campaign、Human Candidate Review、Candidate Verification Request、Coverage |
| [Human OS](docs/domain/human-os/CONTEXT.md) | dynamic verification、Verified Vulnerability、programme scope、Draft、外部行動のauthorization |

## Relationships

| From → To | Handoff | 受け手の責務 |
| --- | --- | --- |
| Target Intelligence → Research | admitted Campaign Input | 固定sourceと条件からCampaignを開始する。選定policyは再評価しない |
| Research → Target Intelligence | Campaign Coverage Receipt | Candidateの詳細から切り離し、重複防止・resume・follow-upに使う |
| Research → Human OS | Candidate Verification Request | Candidate-bound recipeをfreshな実環境で検証する |
| Human OS → Research | Evidence Request | 具体的なproof gapを新しいResearch workとして扱う |

物理的に同じprocessやdatabaseを使っても、別contextのstorageや内部Moduleを直接参照・更新しない。raw model transcriptやwritable worker stateをhandoffにしない。

関係を図で見るには[Architecture](docs/ARCHITECTURE.md)、現在のModuleとhandoffの接続状況は[Codebase Guide](docs/CODEBASE-GUIDE.md)、oracle-freeな入力とCandidate Verificationの制約は[Research Design](docs/RESEARCH-DESIGN.md)へ進む。
