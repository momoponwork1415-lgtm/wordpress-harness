# 日本語用語早見表

この文書は、コード・Issue・設計文書で使う英語の正式語を、日本語で理解するための補助資料である。正式語と厳密な定義の正本は[Context Map](../CONTEXT-MAP.md)と各`CONTEXT.md`に置き、この文書の日本語名はコード識別子として使わない。

## 読み方

- コード、型、event、Issueでは左列の正式語を使う。
- 会話や図では必要に応じて「日本語名（正式語）」と書く。
- 意味が食い違う場合は、[Research](../CONTEXT.md)、[Target Intelligence](domain/target-intelligence/CONTEXT.md)、[Human OS](domain/human-os/CONTEXT.md)の定義を優先する。
- 新しい正式語を追加したら、該当する`CONTEXT.md`を先に更新し、この早見表を後から追従させる。

## 全体構成

| 正式語 | 日本語での意味 |
| --- | --- |
| Target Intelligence | 対象情報。候補の観測、選定、安全な取得を担当する文脈 |
| Research | 調査。対象理解、脆弱性仮説の探索、独立検証、記録、反復を担当する文脈 |
| Human OS | 人間確認基盤。最終確認、追加証拠の要求、外部行動の許可を担当する文脈 |
| Campaign Control | 調査進行制御 |
| Source Understanding | 対象理解 |
| Exploration | 脆弱性仮説の探索 |
| Verification | 独立検証 |
| Model Execution | AI実行管理 |
| Research Record | 調査記録 |

## Argus由来の10設計原則

| 原則 | 日本語での意味 |
| --- | --- |
| Confine | 隔離する。対象、出力先、通信先を閉じた実行領域に置く |
| Constrain | 制約する。範囲、権限、予算、停止条件を先に固定する |
| Focus | 焦点を定める。高水準のsecurity goalまたはmissing linkを与え、探索手順は固定しない |
| Motivate | 目的を与える。重大Findingと高impactへ伸びる未解決点を具体的に追わせる |
| Parallelize | 並列化する。異なるresearch thesisを独立に同時探索する |
| Hypothesize | 仮説化する。反証可能な経路と不足証拠として表す |
| Verify | 検証する。新しい文脈と環境で独立に成立を確かめる |
| Record | 記録する。判断と証拠を追記型で因果関係に結び付ける |
| Prioritize | 優先順位を付ける。影響、根拠、semantic frontier、情報利得、費用から次を選ぶ |
| Iterate | 反復する。必要な時だけ証拠を統合・批判し、freshな次の問いへ進む |

## 対象の選定と受入

| 正式語 | 日本語での意味 |
| --- | --- |
| Intelligence Source | 情報源 |
| Target Observation | 対象観測 |
| Selection Fact | 選定に使える既知脆弱性を含まない事実 |
| Oracle Fact | 探索へ渡してはいけない対象固有の既知脆弱性情報 |
| Vulnerability History Aggregate | 脆弱性履歴集計 |
| Selection Policy | 選定方針 |
| Target Candidate | 対象候補 |
| Plugin Identity | プラグイン識別子 |
| Research-only Candidate | 調査専用候補 |
| Selection Receipt | 選定記録 |
| Target Acquisition | 対象取得 |
| Acquisition Original | 取得原本 |
| Canonical File Manifest | 正規化ファイル一覧 |
| Single Plugin Root | 単一プラグインルート |
| Main Plugin File | 主プラグインファイル |
| Canonical Install Directory | 正規インストールディレクトリ |
| Plugin Basename | プラグイン配置識別子 |
| Manual Target Intake | 手動対象投入 |
| Intake Disposition | 受入判定 |
| Target Intake Packet | 対象受入パケット |

## 調査の準備と実行

| 正式語 | 日本語での意味 |
| --- | --- |
| Target Snapshot | 対象スナップショット |
| Environment Dependency Snapshot | 環境依存スナップショット |
| Canonical Configuration | 基準構成 |
| Setup Plan | セットアップ計画 |
| Setup Receipt | セットアップ記録 |
| Functional Smoke | 正常機能確認 |
| Configuration Variant | 構成差分 |
| Campaign | 調査キャンペーン |
| Setup Blocked | セットアップ阻害 |
| Runtime Profile | 実行環境プロファイル |
| Budget Envelope | 予算枠。hard ceilingでありtoken消費目標ではない |
| Follow-up Campaign | 後続キャンペーン |
| Model Profile | モデルプロファイル |
| Attempt Plan | 実行計画 |
| Source Tool Policy | ソース取得方針 |
| Attempt | 実行試行 |
| Segment | 実行区間 |
| Attempt Receipt | 実行記録 |
| Transport Eligibility Receipt | モデル接続適格性記録 |
| Provider Credential Store | プロバイダー認証保管庫 |
| Prompt Set | プロンプトセット |
| Agent Sandbox | エージェント隔離環境 |
| Verification Lab | 隔離検証環境 |
| Lab Baseline | 検証環境の基準状態 |
| External Dependency Grant | 外部依存接続許可 |
| SecretRef | 秘密情報参照 |
| Credential Broker | 認証情報仲介 |

## 対象理解と探索

| 正式語 | 日本語での意味 |
| --- | --- |
| Surface Map | 攻撃面マップ。探索空間そのものではなく任意のnavigation・evidence・coverage補助 |
| Evidence State | 根拠状態。`observed`、`inferred`、`unknown`の区分 |
| Map Delta Proposal | 地図差分提案。AI Mapperが出す未検査の追加候補 |
| Map Delta Receipt | 地図差分検査記録。候補ごとの受理・拒否を残す記録 |
| PHP Program Index | PHPプログラム索引。navigationやevidenceを補助するが探索範囲を決めない |
| Analysis Unit | 解析単位。Finderへ渡す初期seedであり探索scopeではない |
| Source Evidence Query | ソース根拠問い合わせ |
| Tool Receipt | ツール実行記録 |
| Context Request | 文脈要求 |
| Context Response | 文脈応答 |
| Mapping Evidence Request | 地図根拠要求 |
| Runtime Observation | 実行時観測 |
| Focus Area | coverageや有限workのための観測上の探索領域。Finderのpivotを制限しない |
| Work Lease | 作業割当。研究thesisまたはmissing linkを有限予算でworkerへ渡す記録 |
| Work Wave | 作業ウェーブ |
| Semantic Research Wave | 通常の意味的探索ウェーブ。raw-source-firstで最大4 FinderがTarget全体へ自由にpivotする |
| Depth Admission | 深掘り昇格判断。strong semantic frontierへmulti-waveの追加予算を投資する判断 |
| Depth Campaign | 深掘りキャンペーン。Synthesis、Critic、missing-link Waveを反復する条件付き運行 |
| Iteration Decision | 反復判断。Verification、Depth Admission、次作業、阻害、停止を決めた記録 |
| Exploration Lane | 探索レーン。偏りを観測する目的区分であり固定roleではない |
| Frontier Lane | 高impact frontierを深く追う探索レーン |
| Primitive Lane | 攻撃要素レーン |
| Coverage Lane | 網羅性レーン |
| Exploration Strategy | 探索lens。Finderへ強制する逐次手順ではない |
| Strategy Portfolio | 探索lens・research thesisのポートフォリオ |
| Wildcard Strategy | 自由探索lens |
| Exploration Queue | 探索待ち行列 |
| Hypothesis Seed | 仮説の種 |
| Hypothesis | 仮説 |
| Source-bound Hypothesis | ソース根拠付き仮説 |
| Evidence Route | 証拠経路 |
| Route Fragment | 経路断片。単独severityが低くても高impact compositionに必要なら保持する |
| Chain Synthesis | 連鎖統合。modelがFragmentのsemanticな接続候補を作る判断 |
| Frontier Gap | 高impact経路の具体的な未解決因果link |
| Gap Review | 未探索点レビュー |
| Closure Record | research thesisまたはfrontierの探索完了記録 |
| Coverage Closure | 根拠付き探索完了。Map完成やFinder自己申告だけでは成立しない |

## 検証と判定

| 正式語 | 日本語での意味 |
| --- | --- |
| Preflight Disposition | 事前検査結果 |
| Verification Queue | 検証待ち行列 |
| Experiment | 検証実験 |
| Witness | 成立証拠 |
| Execution Canary | 実行カナリア |
| Causal Control | 因果対照実験 |
| Skeptic Review | 反証レビュー |
| Independent Reproduction | 独立再現 |
| Model Separation Exception | モデル分離例外 |
| Finding | 確認済み脆弱性 |
| Causal Identity | 原因同一性 |
| Blocked | 検証不能 |
| Disproved | 反証済み |
| Incomplete Campaign | 未完了キャンペーン |
| Programme Disposition | プログラム適格性判定 |
| Known Duplicate Disposition | 既知重複判定 |

## 記録、学習、評価

| 正式語 | 日本語での意味 |
| --- | --- |
| Research Ledger | 調査台帳 |
| Lesson | 学習事項 |
| Lesson Proposal | 学習候補 |
| Rule Proposal | ルール候補 |
| Not Codifiable Record | ルール化不能記録 |
| Accepted Static Rule | 採用済み静的ルール |
| Canary Revision | 試験投入版 |
| Knowledge Capsule | 知識カプセル |
| Oracle Leakage Gate | 既知情報漏洩ゲート |
| False-positive Rejection Policy | 誤検出除外基準 |
| Wordfence Eligibility Snapshot | Wordfence適格性スナップショット |
| Development Cohort | 開発用評価群 |
| Boundary Pair | 境界ペア |
| Calibration Context | 校正条件。探索担当から隔離した非公開の評価条件 |
| Calibration Review | 校正判定。境界ペアの成立条件を終端証拠から判定する工程 |
| Calibration Fingerprint | 校正フィンガープリント。異なる実行のFindingを構造証拠で照合する非公開identity |
| Boundary Pair Evidence | 境界ペア成立証拠 |
| Sealed Evaluation Cohort | 封印評価群 |
| Prospective Campaign | 実戦キャンペーン |
| Permitted Attacker | 対象攻撃者 |
| Frontier Discovery Capability | 未知のhigh-impactなsecurity-property破壊を意味理解から発見・実証する能力 |
| Researcher Reference | 研究者参照。公開portfolioから成果水準とmechanism breadthを定める |
| Researcher Reference Corpus | 研究者参照コーパス |

## 人間確認と外部行動

| 正式語 | 日本語での意味 |
| --- | --- |
| Human Review Packet | 人間確認パケット |
| Human Review Case | 人間確認案件 |
| Review Disposition | 確認判定 |
| Human Confirmation | 人間による確認 |
| Evidence Request | 証拠要求 |
| External Action Authorization | 外部行動許可 |
