# トリアージラベル

次の5つを正式な役割として、名前を変えずに使う。

| ラベル | 意味 |
| --- | --- |
| `needs-triage` | ownerによるIssue評価または設計判断が必要。 |
| `needs-info` | 必要な情報が不足している。何が必要かを明記する。 |
| `ready-for-agent` | owner、Interface、失敗時の扱い、受入条件がagent作業に十分な具体性を持つ。 |
| `ready-for-human` | 次の作業に人間の判断または実装が必要。 |
| `wontfix` | 対応しない。理由を記録する。 |

- 各Issueの現在のtriage役割は一つにする。次の作業が変わったら旧役割を置き換え、`bug`、`enhancement`、`documentation`など独立したlabelは維持する。
- `ready-for-agent`は、blockerがないことや外部行動が承認済みであることを意味しない。native dependency、assignee、Issue固有の制約を確認する。
- map Issueはtriage役割なしで`wayfinder:map`を使える。mapに載っているだけで、未解決の設計をreadyにしない。
- label作成前に`gh label list`で既存labelを確認する。この文書へ日付付きの全label一覧を置かない。不足した正式labelは、最初に必要になった時だけ作る。
- Wayfinding labelはtriage役割と分ける。`wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`を使う。
