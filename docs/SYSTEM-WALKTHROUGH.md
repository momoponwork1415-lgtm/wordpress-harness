# System Walkthrough

**一件のTargetを例に、処理の順序と人間が判断する場所を追う。** これは設計上のflowであり、現在の接続状況は[Codebase Guide](CODEBASE-GUIDE.md#current-capability)で確認する。

![一件のCampaignの処理順と人間の判断点](visuals/discovery-validation-architecture.svg)

## 1. Select and approve

Target Intelligenceは取得したsourceと観測factからCandidate Poolを組み立て、AIがTarget Proposalを作る。人間がApproved Target Batchを承認すると、実行直前のfreshnessとsourceの一致を検査してCampaign InputをResearchへ渡す。

## 2. Conduct and review

Researchは一回最大1時間のResearch Grantを実行する。AIの継続提案を受けた人間は、同じCheckpointから次のGrantへ進むか、Candidate Reviewへ移るかを判断する。

人間がCandidateを確認し、Candidate Verificationへ進めるものを選ぶ。Researchへ戻すCandidateがあれば、動的検証より先に戻る。Parked Programme LeadはCandidate Reviewへ進まない。

### 探索Agentへ渡す情報

| 入力の役割 | 内容 |
| --- | --- |
| 対象と参照source | 固定版のread-only Target SnapshotとDependency Snapshots |
| planning data | Campaign Threat ContextとProgramme Research Boundary |
| 実行条件 | Prompt、Agent Runtime Profile、Permission Profile、Grantの許容時間 |
| 承認済みの継続 | 同じbindingのprivate Agent Checkpointと人間が承認したnext action |

RootはCandidateを返すとき、同じsource理解から最小の動的recipeも作る。Runtime Adapterはrecipe本文をGit外のprivate CASへ退避し、Research Recordには参照だけを残す。recipeがなければ`verification-preparation-needed`となる。

oracle-free入力と権限制約の正本は[Research Design](RESEARCH-DESIGN.md#trust-and-versioning)。schema、prompt組立、入力例、recipeの保存場所は[GuideのAgent input](CODEBASE-GUIDE.md#agent-input)から辿る。

## 3. Verify dynamically

Human OSは人間がadmitしたCandidateだけをfreshな使い捨てWordPress / MySQL環境で検証する。Candidate-bound recipeを実Target interfaceへ一度だけ実行し、ソースから脆弱性を再導出する別runは置かない。

| 結果 | 次の状態 |
| --- | --- |
| `runtime-confirmed` | Verified Vulnerabilityを作る |
| `contradicted` | 通常前提とrecipeは完了したがeffectを観測しなかった記録を残す |
| `incomplete` | 環境、依存、recipe、観測、cleanup、証拠の不足をnegativeと分けて残す |

Verified VulnerabilityとResearch Coverageは別artifact。動的検証の結果で探索の完了状態を決めない。

## 4. Assess scope and decide

Human OSはVerified Vulnerabilityを全configured programmeの最新scope snapshotへ照合する。`in-scope`だけにSubmission Candidateを作る。全programmeでOOS、scopeが曖昧、またはscope評価自体が失敗しても技術的なVerified Vulnerabilityは保持する。

AIはSubmission Draftの作成を支援する。人間が一つのSubmission Candidateを選び、exact Draft revisionとdestinationに対する外部行動を承認し、最後のSubmitも行う。

## 再開・失敗を調べる

通常flowから外れた状態、入力の競合、stale review、provider failure、Checkpointの再開条件は[GuideのResearch Campaigns](CODEBASE-GUIDE.md#research-campaigns)と[Native Agent Runtimes](CODEBASE-GUIDE.md#gvisor-native-agent-runtimes)に集約する。
