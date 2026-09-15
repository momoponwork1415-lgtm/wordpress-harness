# System Walkthrough

**一件のTargetを例に、処理の順序と人間が判断する場所を追う。** これは設計上のflowであり、現在の接続状況は[Codebase Guide](CODEBASE-GUIDE.md#current-capability)で確認する。

![一件のCampaignの処理順と人間の判断点](visuals/discovery-validation-architecture.svg)

## 1. Select and approve

Target Intelligenceは取得したsourceと観測factからCandidate Poolを組み立て、AIがTarget Proposalを作る。人間がApproved Target Batchを承認すると、実行直前のfreshnessとsourceの一致を検査してCampaign InputをResearchへ渡す。

## 2. Conduct and review

Researchは一回最大1時間のResearch Grantを実行する。AIの継続提案を受けた人間は、同じCheckpointから次のGrantへ進むか、Candidate Reviewへ移るかを判断する。

人間がCandidateを確認し、Independent Validationへ進めるものを選ぶ。Researchへ戻すCandidateがあれば、Validationより先に戻る。Parked Programme LeadはValidationへ進まない。

### 探索Agentへ渡す情報

| 入力の役割 | 内容 |
| --- | --- |
| 対象と参照source | 固定版のread-only Target SnapshotとDependency Snapshots |
| planning data | Campaign Threat ContextとProgramme Research Boundary |
| 実行条件 | Prompt、Agent Runtime Profile、Permission Profile、Grantの許容時間 |
| 承認済みの継続 | 同じbindingのprivate Agent Checkpointと人間が承認したnext action |

oracle-free入力と権限制約の正本は[Research Design](RESEARCH-DESIGN.md#trust-and-versioning)。schema、prompt組立、入力例は[GuideのResearch Campaigns](CODEBASE-GUIDE.md#research-campaigns)から辿る。

## 3. Validate independently

Independent ValidationはResearchと別のfresh sessionで、同じread-only sourceからCandidateを再検討する。Researchのconversation、Checkpoint、Programme Research Boundaryを共有しない。

| 結果 | 次の状態 |
| --- | --- |
| `source-validated` | immutable Findingを作る |
| `needs-research` | concrete next actionをResearchへ返す |
| `disproven` | source evidenceによる反証を残す |
| `validation-pending` | 判断不能のReceiptを残す。retryは人間の別判断を必要とする |

FindingとCoverageは別artifact。Findingの有無で探索の完了状態を決めない。

## 4. Verify and decide

Human OSはFindingを受け取り、freshな隔離環境でのAI reproductionと、別のfresh環境でのhuman verificationを記録する。失敗や反証も追記し、元のFindingを削除しない。

AIはSubmission Draftの作成を支援する。人間がexact Draft revisionとdestinationに対する外部行動を承認し、最後のSubmitも行う。

## 再開・失敗を調べる

通常flowから外れた状態、入力の競合、stale review、provider failure、Checkpointの再開条件は[GuideのResearch Campaigns](CODEBASE-GUIDE.md#research-campaigns)と[Native Agent Runtimes](CODEBASE-GUIDE.md#gvisor-native-agent-runtimes)に集約する。
