---
name: wordpress-target-selection
description: "WordPressのプラグインまたはテーマから探索対象を比較・選定し、人間の承認と、既知脆弱性を答えとして漏らさないResearchへの受け渡しを作る。WordPress.org、Wordfence Intelligence、VDP、連携製品、探索履歴を使う対象選定で使用する。脆弱性探索、動的再現、提出判断、外部開示には使用しない。"
---

# WordPress対象選定

期待されるセキュリティ探索価値で対象を選ぶ。選定に使う既知脆弱性の集約情報はTarget Intelligence内に留め、Researchへは承認済みソース一式と短いCampaign Threat Contextだけを渡す。

`wordpress-harness`では、先に`AGENTS.md`と`docs/CODEBASE-GUIDE.md`のTarget Intelligence・Research節を読む。実装済みの版付き契約を正本とし、このskillの例から別の製品schemaを作らない。

## 領域を分離する

次の3成果物を分ける。

1. **Selection Record**: Target Intelligenceだけが持つ。候補比較、脆弱性履歴の集約、除外理由、不確実性、プログラム条件、運用費用を含む。
2. **Human Decision**: 正確な対象と版、提案理由、不確実性、承認・除外を含む。承認はResearch開始までで、外部提出を許可しない。
3. **Research Brief**: 承認対象、読み取り専用のソース一式、鮮度、短いCampaign Threat Contextだけを含む。

Selection Record全体をResearchへ渡さない。

## 答えを漏らさない候補情報を作る

探索前に取得できる、許可された公開事実を使う。

- 正確な製品、版、ソースmanifest、観測時刻
- active installs、更新時期、互換性、公開機能、通常構成
- 外部サービス、公開endpoint、連携製品、framework、runtime依存
- 報告経路とプログラム条件
- 公開脆弱性履歴の集約値: 件数、密度、CVSS最大値と分布、High/Critical件数、直近性
- 過去の内部探索範囲と未解決の不確実性

個別advisoryは集約値を作るためにTarget Intelligence内で使える。脆弱性名、CVE、影響ファイル・関数、patch、PoC、版固有の既知経路を提案エージェントやResearchへ渡さない。

選定中に対象PHP、package script、build、test、Composer hook、WordPress bootstrapを実行しない。

## 比較前に適格性を確認する

次をすべて満たす候補だけを比較する。

- 製品と版を一意に特定できる。
- 変更されないソースを取得でき、起動直前に鮮度を再確認できる。
- 宣言した対象範囲で探索と後続検証が許される。
- 報告経路、または調査目的だけで扱う明示理由がある。
- 隠れた権限を仮定せず、通常構成を説明できる。

人間がactive installsの範囲や上限を指定した場合は、その選定だけの適格条件として比較前に適用する。公式ディレクトリの現在値と観測時刻を記録し、`100,000+`などの段階値を正確な実数として扱わない。件数を埋めるために範囲を勝手に広げず、候補数を減らすか新しい人間判断へ戻す。ある実行の範囲を将来の普遍的な既定値にしない。

空の提案は正常な結果である。batchを埋めるためだけに弱い対象を選ばない。

## 固定点数を使わず比較する

次の観点をまとめて判断する。固定weight、全候補の固定順位、理由コード、多様性quotaは要求しない。

- **影響の上限**: identity、session、決済、account ownership、plugin導入、file、database、管理者画面、サイト全体の状態へ影響し得るか。
- **攻撃者からの近さ**: 未認証訪問者、顧客、form送信者、webhook送信者、公開SNS利用者、低権限利用者から通常運用で届くか。
- **境界の豊かさ**: 外部identityからlocal user、決済から認証、公開contentから管理者画面、tokenから認可、保存値から復号後の出力、構造化入力からSQL識別子、URLからpackage導入、pluginからWordPress coreや連携pluginなど、安全上の意味が切り替わる境界があるか。
- **再発の事前分布**: 観測期間やソース規模に対する公開記録数、CVSS最大値、深刻度分布、High/Critical件数、公開時期を確認する。単発の重大記録と重大記録の反復を分け、score欠損や不一致は不確実性にする。履歴は次の脆弱性種類の答えではなく事前分布として使う。
- **更新活発度**: 最近の版更新とPHP変更が、現在読む価値や変更境界を示すか。更新差分を脆弱箇所の答えとしてResearchへ渡さない。
- **運用可能性**: 正確な版、通常構成、依存製品、sandbox用accountやcallbackを後で再現できるか。
- **到達し得る母数**: active installsを影響範囲と運用費用の判断材料にする。ただし単独の選定理由にしない。

ソース規模だけで除外しない。予算はbatch数と同時実行数を制約できるが、大きな対象の探索価値を自動的に下げない。近い候補間のportfolio balanceは人間の判断にする。

## セキュリティ上の意味に必要なソースを閉じる

人間承認後、対象の意味を解釈するために必要な最小のソース一式を固定する。

- 承認版の主対象
- Campaignごとに互換性のある正確なWordPress core
- 通常構成で必要、または意図して有効化する連携plugin/theme
- 境界の意味に関与するruntime libraryまたはSDK source
- sourceがなく利用を許可されたprotocol/API文書

各sourceの版とdigestを記録し、読み取り専用でResearchへ渡す。Human Candidate Reviewで採用されたCandidate Verification Requestは同じTargetとDependencyのbindingを引き継ぐ。依存製品はframework referenceであり、追加の監査対象ではない。

## 短いCampaign Threat Contextを書く

承認済みの公開事実と通常構成だけから次を記す。

- 承認理由と、探索価値を持つ影響
- 通常構成に実在する攻撃者位置
- 守る資産とセキュリティ目的
- trust boundaryと価値の高い意味の遷移
- 関係する依存製品の役割
- 重要な不確実性と仮定
- 想定外の有効な発見も報告対象であること

脆弱性の結論、疑わしいファイル・関数、脆弱性種類、読む順序、固定役割・wave、完了coverageを含めない。仮説、読む順序、subagent、批評、継続、停止はResearch Rootが所有する。

## 人間ゲートで終える

各候補について人間が承認・除外できる根拠を示す。承認後、dispatch直前に対象と依存製品の版、source manifest、公開観測、プログラム対象範囲、必要な外部設定を再確認する。不一致なら新しい版へ勝手に置き換えず、選定へ戻す。

具体的な提案またはResearch Briefを作る場合は[Researchへの受け渡し](references/research-handoff.md)を読む。

明示的な人間承認後、現在の`approved-target-campaign-request`を作り、`campaign conduct-approved`を実行する。受け渡し失敗または新しい人間権限が必要になるまで、同じtaskでResearchを継続し、`stop`後のHuman Candidate Reviewへ進む。
