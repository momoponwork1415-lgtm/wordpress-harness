# 全体構成

**対象情報が調査対象を準備し、探索が脆弱性候補を作り、人間による運用が動的検証・プログラムの対象範囲・提出前の判断を扱います。**

![3領域の責務と版管理された受け渡し](visuals/wordpress-security-research-overview.svg)

## この図の読み方

- 大きな箱は領域、実線の矢印は主要な受け渡し、破線は戻りの受け渡しです。
- 領域ごとに所有する記録があります。別領域の保存先を直接読み書きする関係は作りません。
- 人間の判断点は各領域内に示します。詳しい処理順は[処理の流れ](SYSTEM-WALKTHROUGH.md)へ進みます。

責務・受け渡し・用語の正本は[領域の対応表](../CONTEXT-MAP.md)です。現在のモジュール、Interface、ソース、失敗時の扱い、Behavior Testは[コードベース案内](CODEBASE-GUIDE.md)に集約します。

## 設計を読む入口

| 判断したいこと | 正本 |
| --- | --- |
| AI・Harness・人間の権限をどこに置くか | [探索設計: 判断の担当](RESEARCH-DESIGN.md#decision-ownership) |
| `ResearchCampaigns`の外部Interfaceに何を隠すか | [コードベース案内: Research Campaigns](CODEBASE-GUIDE.md#research-campaigns) |
| プロバイダー固有機能とHarnessの分担 | [探索設計: エージェントによる探索](RESEARCH-DESIGN.md#agent-led-research) |
| 候補の動的検証と確認済み脆弱性の条件 | [探索設計: 候補の検証](RESEARCH-DESIGN.md#candidate-verification) |
| 信頼・隔離・失敗時の共通原則 | [探索設計: 信頼と版管理](RESEARCH-DESIGN.md#trust-and-versioning) |

設計理由が必要なときだけ、対応する設計節からADRへ進みます。
