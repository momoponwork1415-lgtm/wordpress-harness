# Documentation

**コードを変更するなら、[Codebase Guide](CODEBASE-GUIDE.md)で担当Moduleを選び、そのInterfaceとBehavior Testへ進む。** 全文書の通読は不要。

## 読む目的から選ぶ

| 知りたいこと | 入口 |
| --- | --- |
| 全体の責務と受け渡し | [Architecture](ARCHITECTURE.md) — 3 contextの関係を1枚で見る |
| 一件の処理順と人間の判断点 | [System Walkthrough](SYSTEM-WALKTHROUGH.md) |
| 変更箇所・契約・テスト・未接続箇所 | [Codebase Guide](CODEBASE-GUIDE.md) |
| 探索・停止・Validationの設計原則 | [Research Design](RESEARCH-DESIGN.md) |
| 用語の意味 | [Context Map](../CONTEXT-MAP.md)から担当contextの用語集へ |
| 次の有限workと受入条件 | [GitHub Issues](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues) |

## 情報の正本

SSoTは「すべてを一文書へ集めること」ではなく、**同じ事実の更新先を一つにすること**。

| 更新する情報 | 正本 | 他の場所での扱い |
| --- | --- | --- |
| 開発規則 | [AGENTS.md](../AGENTS.md) | 規則を複製せず参照する |
| contextの責務・handoff・用語 | [Context Map](../CONTEXT-MAP.md)と各用語集 | Architectureは関係を図示する |
| mission・研究方針・security invariant | [Research Design](RESEARCH-DESIGN.md) | Guideは担当Moduleと回帰テストへ案内する |
| 現在のModule・Interface・実装状態・source・Behavior Test対応 | [Codebase Guide](CODEBASE-GUIDE.md) | 概要図やWalkthroughへ実装状況を書かない |
| schemaの正確なfield・定数・実行可能なbehavior | Guideから辿るsourceとBehavior Tests | 型定義やprovider設定値を文章へ転記しない |
| hard-to-reverseな判断の理由 | 対応する[ADR](adr/) | 必要な設計節からだけ参照する |
| 実測・外部資料の調査 | [Knowledge](knowledge/) | 通常のReading pathから外す |
| 未完了work・受入条件 | GitHub Issues | 図に「次に作るもの」を並べない |

図は正本から導く説明用のview。全体図は責務とhandoff、処理順の図は人間の判断点と戻り先だけを示す。契約の詳細はGuideへ進む。

完了計画、旧設計、過去snapshotはGit履歴から読む。private Target、payload、transcript、credential、未公開Findingはdocumentationへ入れない。
