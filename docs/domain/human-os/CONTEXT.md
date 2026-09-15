# Human OS — 検証記録と提出前の判断

Researchから受け取ったFindingへ、実環境と人間による確認結果を追記する領域。**報告書と外部行動の承認を管理し、最後の提出は人間が行う。**

## 担当する範囲

再現、確認結果の保存、理解の支援、報告書の作成、提出前の承認を担当する。対象選定、探索、ソース検証、Findingの生成は担当しない。Researchの保存内容を直接変更せず、実際の外部送信も行わない。

## 用語

英語名はコードと照合するための正式な名前。説明はこの領域での意味を示す。

| 用語 | 意味 |
| --- | --- |
| **Finding Handoff** | 独立したソース検証を通った、変更しないFindingの受け渡し。 |
| **Dynamic Reproduction Recipe** | 特定のFindingと対象ソースのハッシュに結び付けた、版付きの非公開再現手順。新しい隔離環境で一度だけ実行する。 |
| **Dynamic Reproduction Lab Setup** | 同じFinding、対象ソース、依存ソース集合に結び付けた通常構成の設定手順。固定した併用プラグインを有効化した後、再現手順の前に一度だけ適用する。 |
| **Isolated Environment** | 対象ソースと実行方式に結び付いた、新しい使い捨ての隔離環境。runscを用い、ホストでの対象実行、暗黙の認証情報、任意の外部通信、弱い隔離方式への切替を許さない。 |
| **AI Reproduction Record** | AIが一つの隔離環境で観測した結果と非公開証拠への参照。元のFindingを上書きしない。 |
| **Human Verification Record** | AIとは別の新しい環境で人間が確認した結果。`human-confirmed`（確認）、`human-disproved`（反証）、`human-incomplete`（未完了）を区別する。 |
| **Private Evidence Reference** | 正確なリクエスト、再現用の入力、画像、実行ログなどをGit外の証拠保管先に結ぶハッシュ参照。 |
| **Submission Draft** | AIまたは人間が作る版付きの報告書。改訂番号は1から連続し、各版の内容をハッシュで固定する。 |
| **External Action Authorization** | 人間が特定の報告書の内容と提出先に対して与える許可。一般的な提出許可では代用できない。 |
| **External Action Admission** | 人間による確認済みの結果、報告書の存在、その内容と提出先への許可を照合する判断。送信は行わない。 |
| **Evidence Request** | 再現や人間の確認で見つかった、足りない証拠を求める受け渡し。外部サービスが必要なら、その名前、検証用の最小権限、人間が決める設定、検証目標を示す。既存Findingは変更しない。 |

## 守るべき区別

- ソースで確認した主張、実環境の観測、人間の確認を分ける。
- 元のFindingを保ち、失敗や反証も追記する。観測不足や設定失敗を反証にしない。
- AIによる報告書作成の支援と、人間による許可・最後の提出を分ける。
- 非公開証拠をGit、Finding、報告書へそのまま展開しない。

隔離と外部行動の設計原則は[Research Design](../../RESEARCH-DESIGN.md#trust-and-versioning)、現在のInterfaceと回帰テストは[Codebase Guide](../../CODEBASE-GUIDE.md#human-os)、領域間の関係は[Context Map](../../../CONTEXT-MAP.md)を参照する。
