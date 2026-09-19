# Human OS — 動的検証、scope、提出前の判断

Researchから受け取ったCandidateを実環境で検証し、技術的な真偽とprogramme適格性を別々に残す領域。**報告書と外部行動の承認を管理し、最後の提出は人間が行う。**

## 担当する範囲

Candidate-bound dynamic verification、Verified Vulnerability、programme別scope、報告書、提出前の承認を担当する。対象選定、探索、ソースからの再導出は担当しない。Researchの保存内容を直接変更せず、実際の外部送信も行わない。

## 用語

英語名はコードと照合するための正式な名前。説明はこの領域での意味を示す。

| 用語 | 意味 |
| --- | --- |
| **Candidate Verification Request** | Research Candidate、対象ソース、private recipe参照をdigestで固定した受け渡し。 |
| **Candidate Verification Recipe** | Candidateと対象ソースのハッシュに結び付けた版付きの非公開手順。新しい隔離環境で一度だけ実行する。 |
| **Candidate Verification Lab Setup** | 同じCandidate、対象ソース、依存ソース集合に結び付けた通常構成の設定手順。固定した併用プラグインを有効化した後、recipeの前に一度だけ適用する。 |
| **Isolated Environment** | 対象ソースと実行方式に結び付いた、新しい使い捨ての隔離環境。runscを用い、ホストでの対象実行、暗黙の認証情報、任意の外部通信、弱い隔離方式への切替を許さない。 |
| **Candidate Verification Record** | `runtime-confirmed`、`contradicted`、`incomplete`の結果と非公開証拠への参照。環境や手順の不足を反証へ丸めない。 |
| **Verified Vulnerability** | `runtime-confirmed`からだけ生成する技術的な脆弱性記録。programme scopeがOOSでも保持する。 |
| **Programme Scope Assessment** | Verified Vulnerabilityを一つのprogramme snapshotへ照合した`in-scope`、`out-of-scope`、`ambiguous`、`stale`の判断。全configured programmeを一度ずつ評価する。 |
| **Submission Candidate** | `in-scope`のProgramme Scope Assessmentからだけ作る、特定destinationへの提出候補。 |
| **Private Evidence Reference** | 正確なリクエスト、再現用の入力、画像、実行ログなどをGit外の証拠保管先に結ぶハッシュ参照。 |
| **Submission Draft** | AIまたは人間が作る版付きの報告書。改訂番号は1から連続し、各版の内容をハッシュで固定する。 |
| **External Action Authorization** | 人間が特定の報告書の内容と提出先に対して与える許可。一般的な提出許可では代用できない。 |
| **External Action Admission** | Verified Vulnerability、in-scope Submission Candidate、報告書、その内容と提出先への許可を照合する判断。送信は行わない。 |
| **Evidence Request** | 動的検証で足りない証拠を求める受け渡し。外部サービスが必要なら、その名前、検証用の最小権限、人間が決める設定、検証目標を示す。 |

## 守るべき区別

- Research Candidate、実環境の観測、Verified Vulnerabilityを分ける。
- 技術的な真偽とprogramme scopeを分け、scope評価の失敗やOOSでVerified Vulnerabilityを失わない。
- 観測不足や設定失敗を`contradicted`にしない。
- AIによる報告書作成の支援と、人間による許可・最後の提出を分ける。
- 非公開証拠をGit、Verified Vulnerability、報告書へそのまま展開しない。

隔離と外部行動の設計原則は[探索設計](../../RESEARCH-DESIGN.md#trust-and-versioning)、現在のInterfaceと回帰テストは[コードベース案内](../../CODEBASE-GUIDE.md#human-os)、領域間の関係は[領域の対応表](../../../CONTEXT-MAP.md)を参照する。
