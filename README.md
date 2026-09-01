# WordPress Harness

WordPressプラグインのsource reviewを、LLMの探索力と独立した実証を組み合わせて反復するresearch harnessです。目指すのは、既知脆弱性のoracleなしにRCEまたは同等のsite-wide compromiseへ至る未知routeを発見・実証できる能力です。SQL injection、Stored XSS、account takeoverも独立した重要Findingおよび重大routeの構成要素として扱います。設計の中心は、Wordfence Argusが示した10動詞です。

> confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, iterate

これらを標語ではなく、実行時に観測できる制御として実装します。Discoveryが作るものは未確認の`Hypothesis`であり、cleanな環境で独立Verificationを通過したものだけを`Finding`と呼びます。

現在は再設計の初期段階です。解析対象として`custom-facebook-feed` 4.12.0と取得時のmetadataが置かれています。旧`whitebox-harness`からcodeやcontractを移植せず、まず最小の研究ループを確立します。旧repositoryの探索系譜は`wp2shell` promptに始まりますが、新しい設計判断の参照資料は保存した3記事に限定します。

## Start here

- [Development rules](AGENTS.md)
- [Context map](CONTEXT-MAP.md)
- [Domain language](CONTEXT.md)
- [Architecture](docs/design/architecture.md)
- [Capability-first roadmap](docs/design/roadmap.md)
- [Design Baseline v0.1](docs/design/baseline-v0.1.md)
- [Design references](docs/REFERENCES.md)
- [Research synthesis](docs/research/agentic-source-review-ten-verbs.md)
- [daroo researcher reference](docs/research/daroo-researcher-reference.md)
- [Why the ten verbs are control properties](docs/adr/0001-ten-verbs-as-control-properties.md)

## Initial scope

最初のvertical sliceは次だけを扱います。

1. plugin sourceとmetadataからWordPress固有の`Surface Map`を作る
2. 重複しない`Focus Area`を作り、探索workerへ割り当てる
3. falsifiableな`Hypothesis`を記録する
4. 別contextかつcleanなlocal WordPress環境で再導出・実証する
5. 結果と失敗から次の探索順を更新する

programme eligibility、報告書作成、vendor communication、patch生成は、DiscoveryとVerificationが実測で機能するまで対象外です。

最初のStored XSS vertical sliceは最終目標ではありません。安全に実行できるbrowser Witnessから研究loopを成立させ、private RCE Boundary Pair、prospectiveな重大脆弱性探索へ段階的に進みます。
