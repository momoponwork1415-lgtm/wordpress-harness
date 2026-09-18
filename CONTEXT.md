# Research — 調査と検証候補の受け渡し

固定したソースを調査し、人間が認めたCandidateを動的検証へ渡す領域。**Candidateと、調査がどこまで終わったかを別々に記録する。**

## 担当する範囲

Target Intelligenceが受け渡した入力を受け取り、調査、継続の人間判断、候補の人間審査、Candidate Verification RequestとCoverageの記録を担当する。対象選定、ソースの取得方針、実環境での検証、programme scope、外部送信は担当しない。

## 用語

英語名はコードと照合するための正式な名前。説明はこの領域での意味を示す。

| 用語 | 意味 |
| --- | --- |
| **Campaign** | 対象、依存ソース、指示文、実行方式、権限、予算を固定した、再開可能な一件の調査。 |
| **Campaign Input** | 調査を開始するための版付き入力。同じ調査IDに異なる入力は使えない。 |
| **Campaign Threat Context** | 対象選定時に把握した通常構成、攻撃者の立場、守る性質、信頼の境界、重要な状態変化、依存関係、不確実性。調査の判断材料であり、想定外の発見を禁止しない。 |
| **Target Snapshot** | プラグインの識別情報、版、ファイル一覧のハッシュで固定した読み取り専用ソース。調査中に更新しない。 |
| **Dependency Snapshot** | WordPress本体などの挙動を確認するため、識別情報、版、ファイル一覧のハッシュで固定した参照用ソース。それ自体は調査対象にしない。 |
| **Native Agent Runtime** | 固定した条件で提供元のエージェントを実行し、結果と失敗の種別を返すModule。研究上の判断は所有しない。 |
| **Root Agent** | 対象全体を見て、仮説、読む順序、補助エージェント、候補を決め、継続や停止を提案するAI。 |
| **Discovery** | ソースに基づく仮説、候補、保留中の手がかりを更新する探索部分。継続提案で次の実行を自動開始せず、途中に動的検証を割り込ませない。 |
| **Native Run Attempt** | providerを呼ぶ前にexactなSealed Native Runと開始時刻を記録する一回の実行試行。terminal Receipt eventがなければorphanedであり、自動再実行せず、integrity-boundなprivate Receipt artifactが一致する場合だけ回復する。 |
| **Research Grant** | 一回の調査実行に与える時間枠。最大1時間で、終了時に報告と再開用の記録を回収する。回収不能なら失敗として残す。 |
| **Independent Research Trial** | 以前の結果やCheckpointを入力せず、freshなCampaignとして始める外側の一試行。同じCampaign内の継続Grant、通信retry、出力形式の再試行は別Trialに数えない。 |
| **Evaluation Sweep** | 固定した評価対象集合の各TargetへIndependent Research Trialを一回ずつ行う評価単位。同じTargetへの複数Trialや一Campaign内の複数Grantとは区別する。 |
| **Research Report** | 一回の実行が返す、Grant内で調べた領域と未調査領域のsource-backed summary、Research Assessment、候補、保留中の手がかり、継続または停止の提案。 |
| **Research Assessment** | 具体的なsecurity propertyをsourceから調べたがCandidateにはしなかった記録。反証できたrouteまたは決定的事実が不足するrouteを、controlの証拠とexact blocker付きで残し、Coverage unitや次の作業割当にはしない。 |
| **Human Research Continuation Review** | 継続提案に対する人間の判断。対象の入力・実行・再開記録・候補・保留記録・次の作業をハッシュで結び付ける。`continue-research`だけが次の時間枠を開始し、候補がある場合は`proceed-to-candidate-review`を選べる。 |
| **Agent Checkpoint** | 同じ条件で会話と作業メモを再開するための非公開記録への参照。研究上の結論ではなく、Candidate Verificationや他の領域へ渡さない。 |
| **Agent Run Diagnostic** | 失敗箇所、認証情報を除いた出力、再開用に受理できなかった隔離状態を保持する非公開の診断記録への参照。正常終了でも出力を拒否した場合は残す。自動再開には使わない。 |
| **Next Action** | 次に確かめる具体的な問いとソースの位置。AIが継続を提案する根拠であり、Harnessが割り当てる作業キューではない。 |
| **Research Candidate** | 攻撃者の前提、破られる安全上の性質、主張、入口からeffectまでのsource trace、既存controlへの反証と未解決事実を持つ検証候補。対象とする影響の範囲は[Research Design](docs/RESEARCH-DESIGN.md#goal)で定める。 |
| **Candidate Verification Recipe Reference** | RootがCandidateと同じ調査runで作る非公開の動的手順へのcontent-addressed参照。本文やpayloadはResearch Recordへ入れない。 |
| **Parked Programme Lead** | 現時点のソースでは対象となる影響への具体的なつながりが示せない手がかり。最小限の前提、影響上限、証拠だけを残し、Candidate ReviewやCandidate Verificationへ進めない。 |
| **Human Candidate Review** | 探索を区切った時点のCandidate集合に対する人間の判断。Candidate Verificationへ進めるか、具体的な次手とともにResearchへ戻す。programme scopeはここで技術的な検証を止める条件にしない。 |
| **Candidate Verification Request** | 人間がadmitしたCandidate、固定source、private recipe参照をdigestで結んだHuman OSへの受け渡し。recipeがなければ生成しない。 |
| **Verification Preparation Needed** | admitされたがrecipeがなく、Requestを安全に作れない状態。Candidateを棄却せず準備不足として残す。 |
| **Coverage** | 固定した調査条件の中で、具体的に調べる余地が残るかを表す記録。発見件数や対象の安全性を意味しない。 |
| **Interruption** | 予算、提供元、権限、不正な出力などにより、判断を完了できなかった記録。 |
| **Research Admission Failure** | Native Runは正常終了して証拠を返したが、CandidateまたはParked Programme Leadのidentity・Programme Boundary制約により、そのrunのResearch結果をCampaignへ採用できなかった記録。元のReceiptを改変せず、Campaignを未完了にする。 |
| **Research Record** | 入力、実行結果、非公開記録への参照、両方の人間判断、Candidate Verification Request、Coverage、中断を追記する正本。会話本文や作業メモ、内部の呼び出し順を業務上の状態にしない。 |

## 守るべき区別

- 調査の継続提案と、人間による次の実行の承認を分ける。
- Candidateの発見、人間によるadmission、Human OSの動的検証を分ける。
- Candidate Verification Request、Coverage、実行失敗を混同しない。
- 再開可能な記録と、診断専用の記録を分ける。
- Native Runの正常終了と、そのResearch結果をCampaignへ採用できたかを分ける。
- Native Run Attemptの開始、providerの終了、Receiptのdurableな記録を分け、orphaned attemptを未実行または失敗Receiptへ読み替えない。
- 同じ履歴を継続するResearch Grant、freshなIndependent Research Trial、評価対象全体のEvaluation Sweepを分ける。

権限・隔離・予算・失敗時の設計原則は[Research Design](docs/RESEARCH-DESIGN.md#trust-and-versioning)、現在のInterfaceと回帰テストは[Codebase Guide](docs/CODEBASE-GUIDE.md#research-campaigns)を参照する。

## 使わない用語

Finder Wave、Depth Campaign、Depth Admission、Harness-owned Approach Family Registry、Work Lease、Root Synthesis、Validation Queue、fixed rubricは現在の業務モデルに含めない。Approach Family RegistryはRoot Agentが内部の作業メモとして使うもので、Harnessの状態や領域間の受け渡し形式にはしない。

領域間の関係は[Context Map](CONTEXT-MAP.md)を参照する。
