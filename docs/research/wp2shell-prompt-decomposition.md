# wp2shell由来Promptの責務分解

Status: legacy analysis, 2026-09-02

## 結論

旧`wp2shell` Promptの価値は、特定の言い回しではなく、探索を止めない動機、異質な探索、独立した反証、記録、有限な停止条件を一つの実行loopへ結び付けたことにある。一方、既知のpre-auth RCEと`/flag`を先に保証する記述、model自身にparallelism・budget・永続化を管理させる記述は、未知脆弱性を探すproduction Campaignへ移植しない。

したがって原文を一枚の巨大Promptとして復元せず、`Role Prompt + Campaign Policy + Work Assignment + selected Knowledge + runner-enforced controls + typed output`へ分解する。これは[ADR 0004](../adr/0004-mine-the-legacy-repository-do-not-port-it.md)と[ADR 0029](../adr/0029-render-one-versioned-prompt-set.md)を具体化するlegacy evidenceであり、3件の公式設計参照資料を増やすものではない。

## 調べたlegacy artifact

- `wp2shell/toolkit/PROMPT.template.txt`: 最初のzero-day chain探索Prompt
- `wp2shell/toolkit/PROMPT.article.template.txt`: 公開記事に近い短いPrompt
- `wp2shell/toolkit/PROMPT.cdc-variant.template.txt`: CDC由来の独立探索規則を明示したvariant
- `whitebox-harness/skills/discover-wordpress-target/PROMPT.md`: WordPress plugin向けに拡張したPrompt
- `whitebox-harness/skills/discover-wordpress-target/BARE_PROMPT.md`: classと出力を絞ったbounded版

Target固有source、過去run transcript、Lead、PoCは分析対象へ含めていない。原文は現在のrepositoryへコピーせず、責務と失敗条件だけを抽出した。

外部一次資料として、発見者本人の[wp2shell full write-up](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6)と、そこから参照されたOpenAIの[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)を確認した。これらも本projectの公式設計参照資料ではなく、Prompt系譜と実行過程を理解する一次資料として扱う。

## 記事を読んで分かった実際のloop

発見者はOpenAIのCDC Promptをsecurity research向けに変え、WordPress sourceへ4agent・最低6時間の条件で適用した。Git historyとweb diffを避けた理由はnovel discoveryにtokenを集中させるため、typical productionという条件はmodelが成立しないpreconditionを作ることを抑えるため、dependency sourceを読む指示は未知のAPI semanticsを検索や記憶で補わせないためだった。

ただし成功経路は完全な一回のautonomous runではない。

1. modelがpre-auth SQLiを候補として出した。
2. 人間がstock WordPressへ独立に当て、実データが読めることを確認した。
3. 人間がそのprimitiveをRCEへ伸ばせるか再度modelへ依頼した。
4. 約4時間後に長いchainが得られ、人間が翌日その機構を解きほぐして報告した。

本ハーネスは通常の人間介入を前提にしないため、手順2と3の間にあった人間判断を`Verification -> verified Route Fragment -> Chain Synthesis -> Frontier Work Lease`として自動化する必要がある。単一Finderに最初からRCEの全chainを要求し続けるだけではない。

これはwhitebox-harnessが人間介入型だったという意味ではない。whitebox-harnessのDiscovery run自体は、root agentがworkerの起動、registry、複数wave、再探索、closure、`leads.json`まで進める完全自律方式だった。現設計で修正するのは自律性ではなく、scheduler、budget、resume、record、verification境界の多くがPromptとprovider agentの裁量に置かれていた点である。完全自律は維持し、その制御をharness-ownedなcontractとreconcilerへ移す。

## CDC Promptから継承されたもの

OpenAIのCDC Promptは「完全な肯定証明が存在する」と先に保証したうえで、64並列、8時間以上、独立したapproach family、早すぎる収束の防止、停滞したmissing lemmaの明示、adversarial audit、具体的なlemma・construction・counterexample、rootによる再統合を要求していた。

wp2shell Promptは数学用語をsecurity用語へ置き換え、並列数を4、最低時間を6時間へ縮めた。主要な構造は同じである。

| CDC | wp2shell | 現ハーネスでの対応 |
|---|---|---|
| approach family | attack/research idea family | Focus Area + Strategy + Coverage ownership |
| missing lemma | exact unresolved exploit gap | unknown edge + Mapping Evidence Request |
| concrete construction | source path、guard、state、sink | Evidence Route + Route Fragment |
| adversarial proof audit | concrete bugのsanity check | Independent Verification + Causal Control |
| root synthesis | chainの接続と次round | Wave barrier + Chain Synthesis |
| complete proof | pre-auth RCE chain | Frontier Finding。ただしprimitiveも保持する |

CDC Promptの「肯定解が存在する」「部分結果は価値がない」はbenchmark solverを強く動機付けるが、未知Targetへは移さない。SQLi、Stored XSS、ATO、file primitiveは単独でもFinding候補であり、後からchainへ接続できるRoute Fragmentでもあるためである。

## 一枚のPromptに混在していた責務

| 旧Promptの責務 | 現在のowner | 残すもの | 変更するもの |
|---|---|---|---|
| 固定sourceとdependency source | Target Intake / Source Mapping | digest固定Target、実sourceから意味を確認 | physical pathをworker contractにしない |
| first-principles review | Finder Role Prompt | sourceからrouteを作り、未知を明示 | 既知Findingの存在を保証しない |
| unauthenticatedからRCEまでの強いgoal | Campaign Policy / Frontier Lane | site-wide compromiseをNorth Starにする | TargetにRCEが必ずあるというoracleを除く |
| approach familyの多様性 | Exploration | Strategyを別軸にし、未所有surfaceを残す | provider agentの自由な割当てに任せない |
| 最大4agentとwave反復 | Campaign Control | 独立Work Lease、最大3並列、Wave barrier | worker自身にspawn・再割当てさせない |
| adversarial double-check | Verification | fresh contextでsourceと実験を再導出 | 同じconversation内の賛否や多数決にしない |
| tool-call・wall-clock上限 | Model Execution / Campaign Control | AttemptとCampaignの有限budget | modelの自己申告や時刻推測で強制しない |
| `research/*.md`とregistry | Research Record / Exploration | negative evidence、blocked route、再開理由を保存 | Markdownを正本stateやworker間handoffにしない |
| dependency behaviorを記憶で決めない | Source Mapping / Knowledge | pinned sourceまたは版付きKnowledgeを根拠にする | 全dependencyを全Promptへ常時投入しない |
| 連続waveで新規性がなければ停止 | Closure Policy | evidence-bearing closureと有限iteration | Finderの「もうない」という自己判断でTargetを閉じない |
| `leads.json`のclosed schema | Hypothesis / Finding contracts | typed identity、attacker、route、terminal、unknown | LeadをVerification前の成立Findingにしない |

## 10設計原則への対応

```text
confine      Target Snapshot / Sandbox / Oracle Leakage Gate
constrain    Attempt budget / tool manifest / output schema
focus        Focus Area / Work Assignment / selected Knowledge
motivate     Role goal / falsifiable terminal / closure obligation
parallelize  independent Work Leases / deterministic Work Wave
hypothesize  source-bound Hypothesis / unknown / next experiment
verify       clean Verifier / Witness / Causal Control
record       CAS artifact / Research Ledger / Closure Record
prioritize   evidence route / information gain / coverage debt
iterate      Mapping Evidence Request / next Wave / bounded closure
```

旧Promptはこの大半を文章上は含んでいた。しかし`confine`、`constrain`、`record`、`parallelize`をmodelへのお願いだけで成立させていた。現ハーネスでは同じ意図をcontrol planeと型付きartifactへ移す。

## Prompt Setへ残す文章

Promptは次に集中させる。

1. **Role Prompt**: sourceから因果routeを作り、事実・推論・未知を分け、反証条件を示す。
2. **Campaign Policy**: Permitted Attacker、許容terminal、oracle禁止、Targetを安全と断定しないclosure規則。
3. **Work Assignment**: 一つのFocus Area、Strategy、Target Snapshot、Work Lease、残budget。
4. **Selected Knowledge**: 当該Focusに必要なWordPress/PHP semanticsだけをprovenance付きで渡す。
5. **Output obligation**: Hypothesis、Mapping Evidence Request、Route Fragment、Closure Recordのいずれかをschema通り返す。

「別workerを起動せよ」「何時間続けよ」「fileへ直接記録せよ」「shellを自由に使え」はPrompt Setから外す。これらはCampaign Control、Model Execution、Tool Gateway、Research Recordが強制する。

## productionへ持ち込まないoracle

最初のPromptは、対象にpre-auth RCEが存在し、成功すればrootの`/flag`へ到達すると先に教えていた。これはbenchmark課題としては強いmotivationになるが、production Discoveryでは次を歪める。

- FinderがRCEへ都合のよい未解決hopを補完する。
- SQLi、Stored XSS、ATO等の実在primitiveを「RCEでない」ため捨てる。
- Findingなしの正しいTargetと、探索不足のTargetを区別できない。
- known positiveで成功したPromptを未知Targetへ一般化したと誤認する。

North StarはCampaign全体のpriorityとして保持する。個々のFinderには「RCEが存在する」ではなく、割り当てられたFocusのsecurity propertyと、sourceが支持する最強terminalまで追う義務を与える。

## whitebox-harness版の限界

whitebox-harness版は旧Promptをplugin bug bounty向けに実用化したが、完成形ではない。

1. **Programme policyの過積載**: Wordfenceで受理されるclass、除外class、premise、出力enumまでFinder Promptへ入れ、探索とProgramme Eligibilityを混ぜた。
2. **早すぎる自己検閲**: SSRF、IDOR、情報漏洩、弱いstate change等をterminalとして落とす規則が、中間primitiveやchain材料まで捨てさせる可能性がある。
3. **Leadへの早期圧縮**: 最大5件の`leads.json`へ直接まとめるため、相反するroute、negative evidence、Route Fragment、unresolved edgeが失われやすい。
4. **文章による並列制御**: agent cap、worker寿命、registry更新、root ownershipをprovider Promptへ依存し、Campaign再開とbudget accountingの正本が曖昧だった。
5. **巨大な注意事項**: security reasoning、Wordfence規則、machine schema、file操作、closureを一度に要求し、modelのattentionを分散させた。
6. **Verificationとの境界不足**: 「二重確認」は要求したが、fresh context、Target digest、Witness、Causal Controlを実行基盤で保証していなかった。
7. **dependency routeの圧縮**: dependency sourceを読む一方で最終`source_path`を`main/`だけに限定し、cross-component causal routeを正本artifactへ残しにくかった。

現ハーネスではFinderが高recallなHypothesisとRoute Fragmentを残し、Programme Eligibilityは技術的Finding成立後にHuman OSが判定する。除外classはDiscovery禁止表ではなく、Verificationのfalsifierと提出適格性の判定材料にする。

## Tool Gatewayへ移す有用な知見

旧Promptの「空の検索結果を事実にする前に、同じtool・path・optionで既知文字列を見つけられるか確認する」は、modelの注意事項として残すよりTool Gatewayの健全性へ移す価値がある。

`Search Receipt`は少なくともquery、scope、対象file数、走査byte数、truncation、tool/index version、結果digestを記録する。Gateway起動時は合成fixtureでsearch/read/symbol/graphのhealth checkを行う。これにより次を区別できる。

- 正常に走査してmatchがゼロだった。
- scopeが空、pathが誤り、indexが未生成だった。
- budgetまたは上限で探索が途中終了した。
- tool自体が失敗した。

Target内に「必ずある文字列」をmodelが毎回選ぶ方式は、余分なcallと誤った自己確認を生むため採らない。health checkと各Receiptをharness側で検査する。

## 現設計との差分と次の順序

現在はTarget Snapshot、Surface Map、Focus、Work Lease、typed Hypothesis、独立Verification、CAS/Ledger、最大3並列まで責務分離されている。tool-free固定source sliceだけが、旧Promptの「必要なsourceを自分で読む」能力をまだ失っている。

次のvertical sliceは次の順で行う。

1. bounded `search`と`read`、健全性を示すTool ReceiptをModel Execution内部へ追加する。
2. `symbol`と`graph`を同じpath・Lease・byte・turn budgetへ接続する。
3. Finderが不足sourceを取得できたかを`Context Reach` gateで観測する。
4. その後にFocus順位補正を入れ、同じModel Profile・Target・Focusで比較する。

Prompt wordingの調整を先に行うと、取得能力の改善と文章効果を分離できない。まずTool Gatewayを通し、その固定条件で旧Prompt由来のmotivation、closure、portfolio表現を小さなPrompt Set versionとして比較する。
