# Agentic source-code review harness: 10動詞による再設計メモ

- 調査日: 2026-09-01
- 対象: 新しい WordPress 向け white-box vulnerability research harness の設計原則
- 一次資料: Wordfence Argus、Google/Mandiant AVDH、Anthropic Defending Code Reference Harness

## 結論

新しい harness は、10動詞を単なる理念ではなく、**状態遷移・成果物・合否基準を持つ実行契約**として実装するのがよい。

> confine → constrain → focus → motivate → parallelize → hypothesize → verify → record → prioritize → iterate

ただし、これは必ずしも一方向の10段パイプラインではない。設計上は次の5群に分けると責務が明確になる。

1. **境界** — confine / constrain
2. **探索** — focus / motivate / parallelize / hypothesize
3. **証拠** — verify / record
4. **意思決定** — prioritize
5. **学習** — iterate

中核となる判断は次の4点である。

- オーケストレーターは決定的にし、LLM は狭い work unit の中だけで非決定的に働かせる。
- 発見は high-recall、検証は high-precision として、コンテキスト、権限、成功条件を分離する。
- 並列化は「同じ依頼を N 回」ではなく、重ならない探索面または独立した反証観点に対して行う。
- 反復の単位を run ではなく、`仮説 → 証拠 → 判定 → 学習可能な記録` の閉ループにする。

## 一次資料から確認できること

### Wordfence Argus

Wordfence が公開している Argus の内部設計情報は意図的に限定されている。同社が明示したのは、内部の aggressive vulnerability hunting application であること、設計アプローチを10動詞で表していること、モデル非依存で capability と price の均衡を継続評価していること、そして競争力の源泉を prompt engineering、harness design、task-specific model selection、deterministic programming の組み合わせと見ていることである。10動詞それぞれの具体的な実装は公開されていない。したがって、本メモの動詞別定義は Argus の再現ではなく、残る2資料で裏付けた**こちら側の運用定義**である。[Wordfence, “Wordfence Argus: Moving Beyond Human Research Capability”](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)

### Google/Mandiant AVDH

AVDH は、専門化した agent を決定的な逐次パイプラインで接続し、その各段で必要な並列処理を行う構成である。資産情報、SBOM、アーキテクチャ文書、脅威情報を入力し、探索 agent と specialist による threat model を人間が承認してから先へ進む。その後、in-scope file の entry point discovery、entry point ごとの context enrichment、access-control/data-flow 仮説生成へ進む。[Google/Mandiant, “Architecting the Pipeline”–“Context Enrichment”](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

仮説生成段階は自己検証を最小限にして発散させ、consultant-configured confidence filter で量を制御する。検証段階では別の複数 agent が各仮説を評価し、synthesis agent が confirmed / disproven / rejected を決定する。さらに confirmed finding は deduplicate と risk-rate の後、人間が PoC を動的に再現し、失敗したものを破棄する。[Google/Mandiant, “Hypothesis Generation”–“Expert Validation”](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

また AVDH は、専門家知識を domain → language/framework/vulnerability rule の階層で注入し、合成コードベースの ground truth、grading agent、edge-case triage、人間の judge 確認を組み合わせて変更を評価する。これは harness の改善自体にも検証ゲートが必要であることを示す。[Google/Mandiant, “Distilled Knowledge”–“Measuring Success”](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

### Anthropic Defending Code Reference Harness

Anthropic は、scan 前に threat model を作り、探索空間を異なる focus area または input-processing subsystem に分割することを推奨する。同じ目的の parallel agent は浅い同一 finding に収束しやすいため、各 agent に「どこを、何について探すか」を明示する必要がある。[Anthropic, “Before you scan: map, scope, equip”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#before-you-scan-map-scope-equip)

発見と検証は逆の目的を持つため分離する。発見は speculative candidate を許容し、検証は exploitability のない候補を落とす。検証には安価な deterministic gate、finder が触れていない clean sandbox、書面の説明より executable witness、成功条件をすり抜けられない判定 oracle が必要とされる。[Anthropic, “Verification: the load-bearing component”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#verification-the-load-bearing-component)

重大度は脆弱性カテゴリ名ではなく precondition から導き、モデルの severity は triage 順のヒントとして扱う。CVSS の数値計算はモデルに任せず、vector を決めた後に calculator で決定する。[Anthropic, “Severity and triage”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#severity-and-triage)

同資料は、初回に N agent を横並列するより、find → fix → find の反復が新しい finding を押し出すとする。複数 run の union、PoC の regression test 化、validated primitive と dead end の記録、実 transcript から cheatsheet を更新する flywheel を推奨している。[Anthropic, “Iterating: scale and convergence”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#iterating-scale-and-convergence)

無人実行については、依存関係を準備できる setup phase と、外向き通信を model API のみに絞る attack phase を分ける。また worker とは別コンテキストの supervisor が idle、retry loop、cost を監視する。[Anthropic, “Unattended runs: supervision and containment”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#unattended-runs-supervision-and-containment)

## 10動詞の運用定義

| 動詞 | harness における意味 | 最小の実装契約 | 観測する指標 |
|---|---|---|---|
| **confine** | target execution と agent の blast radius を閉じ込める | run ごとの disposable sandbox、read-only target snapshot、ephemeral credential、egress allowlist、host/workspace 非共有 | scope 外通信・書込の拒否件数、sandbox 再現率、残存 state 数 |
| **constrain** | 何を脆弱性と数え、何を agent に許すかを固定する | versioned threat model、in/out-of-scope、role/trust boundary、tool/action policy、時間・token・試行 budget、stage gate | scope 違反率、policy 未指定項目、budget overrun、threat-model 不一致 reject |
| **focus** | 全コードを漫然と読む代わりに、到達可能な攻撃面へ attention を配る | entry-point inventory、trust-boundary map、distinct focus area、risk-ranked queue、必要な周辺コードだけを enrich | entry point coverage、未担当 surface、work unit 間 overlap、到達不能候補率 |
| **motivate** | agent に曖昧な persona ではなく、達成可能な局所目標と判定条件を与える | work unit ごとの objective、required artifact、success/failure oracle、stop condition、supervisor の nudge/restart 規則 | 完了率、idle/retry loop、oracle 未提示率、目的外 output |
| **parallelize** | 独立した探索面または独立した反証を同時に処理する | recon による重複しない partition、stage barrier、仮説ごとの独立 verifier、結果 union と dedup | wall-clock、重複率、partition coverage、verdict diversity、cost/finding |
| **hypothesize** | 証明前の candidate を high-recall で生成する | source–path–sink / auth premise、必要 precondition、想定 impact、反証可能な test idea を持つ typed hypothesis | hypothesis 数、novelty、後段 confirmation rate、未探索 class |
| **verify** | candidate を独立した証拠で潰すか確定する | finder と分離した context、immutable snapshot、category-specific verifier、clean sandbox の PoC、skeptical critic/judge、人間 gate | false-positive rate、再現率、3/3 成功率、disproved/rejected 理由、human overturn rate |
| **record** | 追跡・再現・学習に必要な因果を append-only で残す | prompt/model/tool/version、target digest、input/output、hypothesis ledger、commands、logs、artifact hash、verdict rationale、cost | provenance 完全率、再実行可能率、孤立 finding、欠落 negative evidence |
| **prioritize** | 限られた検証・修正時間を実害の大きい confirmed finding に配る | dedup 後に reachability、attacker precondition、impact、confidence、asset criticality、novelty で並べる。CVSS score は tool 計算 | precision@k、time-to-critical、duplicate reduction、aging、human rerank rate |
| **iterate** | finding と失敗を次の探索能力へ変換し、収束を測る | confirm → regression test/rule、fix → re-run、miss/dead end → lesson、benchmark gate、net-new yield による停止判断 | run ごとの net-new confirmed、再発率、benchmark regression、rule hit-rate、cost/confirmed |

## 推奨アーキテクチャ

```text
                         deterministic control plane
┌─────────────────────────────────────────────────────────────────────┐
│ Target intake → Policy/Threat model → Recon/Partition → Scheduler  │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
        disposable workers             append-only evidence plane
   ┌───────────▼───────────┐       ┌──────────▼─────────────────────┐
   │ focused finders (N)   │──────▶│ hypotheses / traces / ledgers │
   └───────────┬───────────┘       └──────────┬─────────────────────┘
               │                              │
   ┌───────────▼───────────┐                  │
   │ independent verifiers│──────────────────▶│
   │ + dynamic PoC sandbox│                  │
   └───────────┬───────────┘                  │
               ▼                              ▼
        synthesize / dedup / risk-rank → human approval → disclosure/fix
               ▲                                      │
               └──── benchmark / rules / lessons ◀────┘
                            learning plane
```

Google の「逐次パイプライン」と Wordfence の `parallelize` は矛盾しない。**stage 間は barrier を持つ逐次処理、stage 内は partition 済み work unit の並列処理**と解釈する。Anthropic の「iteration beats raw parallelism」とも、1 pass 内の breadth は parallel、pass 間の convergence は iterate と責務を分ければ両立する。

### 制御面

LLM に次の stage や権限を自由に決めさせず、状態遷移をコードで管理する。

```text
INGESTED
  → SCOPED
  → MAPPED (human approval when policy is new/changed)
  → PARTITIONED
  → HYPOTHESES_GENERATED
  → VALIDATED
  → DYNAMICALLY_REPRODUCED
  → TRIAGED
  → ARCHIVED / FIXED
  → REQUEUED
```

各遷移は schema validation と policy gate を通り、失敗を「agent に再解釈させて先へ進む」のではなく、理由付き terminal/retry state として記録する。

### worker 面

worker は長寿命の万能 agent にせず、一つの目的だけを持つ disposable process にする。

- explorer: target の構造、role、entry point、trust boundary を列挙する。
- partitioner: 重複しない focus area と coverage claim を作る。
- finder: 狭い work unit 内で typed hypothesis を生成する。
- critic/verifier: finder の会話を受け取らず、仮説と必要 artifact だけを反証する。
- reproducer: clean runtime に対して PoC を実行し、機械判定可能な witness を作る。
- synthesizer: verifier vote を集約するが、証拠そのものを書き換えない。
- triager: dedup と precondition-based ranking を行う。
- supervisor: worker の content を代行せず、idle/loop/spend/coverage のみを見る。

### 証拠面

最低限、次の versioned artifact を JSON と人間可読 Markdown の双方、またはいずれかから再生成可能な形で持つ。

| Artifact | 必須内容 |
|---|---|
| `TargetManifest` | target digest、plugin/version、runtime matrix、dependency snapshot、build recipe |
| `PolicyCapsule` | scope、禁止 action、egress、credential、budget、disclosure policy |
| `ThreatModel` | actor/role、asset、entry point、trust boundary、security invariant、除外理由 |
| `WorkUnit` | focus area、対象 entry point、coverage claim、必要 context、completion oracle |
| `Hypothesis` | premise、source/path/sink または auth chain、precondition、impact、test idea、provenance |
| `VerificationAttempt` | clean snapshot id、method、command/input、raw result、witness hash、verdict、反証理由 |
| `Finding` | confirmed evidence への参照、root cause、affected version、dedup key、severity vector、human status |
| `RunManifest` | model/prompt/tool version、全状態遷移、cost/time、coverage、親子 artifact hash |
| `LessonOrRule` | 由来 finding/miss、適用条件、期待効果、benchmark case、retirement condition |

重要なのは、`Finding` を agent の長文 report そのものにしないことである。finding は immutable evidence への参照を持つ集約物とし、再 triage や report generation で原証拠が失われないようにする。

## 動詞間の緊張関係と設計判断

### confine と context richness

Google と Anthropic は多くの環境コンテキストが精度を上げるとする一方、Anthropic は verifier の filesystem/environment/conversation 分離を要求する。解決策は「全部を共有する」ことではなく、stage ごとに許可された artifact を明示的に渡すこと。finder には探索用 context、verifier には仮説と frozen target、triager には確定証拠と threat model を渡す。

### hypothesize と verify

同一 prompt で両方を最適化しない。finder が自己検閲すると false negative が増え、finder が自説を検証すると confirmation bias と shared-state contamination が起きる。両 stage は別の system instruction、別 session、別 writable layer、別 success metric を持つ。

### parallelize と iterate

並列化を増やす前に recon の coverage を増やす。重複率が高いときは worker 数ではなく partition を見直す。反復では、confirmed finding を patch または known-findings mask で探索空間から除き、次の pass が同じ浅い finding に再収束しないようにする。

### model agnostic と reproducibility

Argus の model-agnostic 方針を採るなら、model adapter の共通 API だけでは足りない。`model id + immutable prompt version + decoding parameters + tool policy + context bundle hash` を run に固定し、同じ benchmark suite で capability、precision、latency、cost を比較する。モデル切替は configuration change ではなく、評価対象となる harness release とみなす。

### autonomy と human accountability

agent の役割は lead、証拠、優先順位を高速に作ること。外部への disclosure、不可逆な containment、high-severity の最終確定は人間 gate に残す。Anthropic は open-source finding を外部へ出す前に、特定 release での人間の再現、実 interface からの到達性、引用した path/function/line の実在確認を求めている。[Anthropic, “Open-source targets”](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md#open-source-targets)

## この WordPress harness への適用

現在の workspace は、抽出済み plugin source、配布 ZIP、WordPress.org metadata を含む target-centric な形で、既存の harness 文書規約は見当たらない。この構成から始めるなら、最初の vertical slice は大規模な multi-agent platform ではなく、次を end-to-end で通すものにする。

1. plugin ZIP と metadata から immutable `TargetManifest` を作る。
2. WordPress/PHP の固定 runtime を disposable environment に立てる。
3. threat model と entry-point inventory を作り、人間が scope を承認する。
4. 一つの focus area を一つの finder に割り当て、typed hypothesis を出す。
5. finder と分離した verifier が source trace を反証する。
6. clean environment で PoC を実行し、機械判定可能な witness を保存する。
7. confirmed finding だけを ranking queue に入れ、全 artifact と cost を run manifest に記録する。
8. PoC を regression fixture に変換し、同 target でもう一度探索する。

旧 whitebox-harness の実装を先に移植するより、この一本の `TargetManifest → verified Finding → next iteration` 契約を先に固定するとよい。旧資産は、各契約を満たす adapter、rule、fixture として選別して取り込める。

## 最初に固定すべき非交渉条件

- target と verifier の snapshot は immutable かつ digest で同定できる。
- discovery transcript は verification context に渡さない。
- `confirmed` は書面上の説得力ではなく、category-specific evidence gate を通過した状態名である。
- scope、credential、egress、budget は prompt だけでなく実行基盤でも強制する。
- すべての finding は target version、threat-model version、evidence、verdict history へ逆引きできる。
- parallel worker を増やす前に partition coverage と overlap を測る。
- model/prompt/rule の変更は ground-truth benchmark を通過しない限り昇格させない。
- 公開・報告は人間が再現性、到達性、対象プロジェクトの policy を確認した後に行う。

## 未確定事項

3資料だけでは、次は決められない。実装設計時に明示的な decision record が必要である。

- WordPress runtime の isolation 技術と、setup/attack phase の具体的 network policy
- どの vulnerability class を static proof、dynamic PoC、複数 judge のどれで確定するか
- coverage の分母を file、entry point、hook、role、data-flow path のどれに置くか
- target ごとの時間・token・金額 budget と停止条件
- finding schema、severity standard、responsible-disclosure workflow
- synthetic benchmark と既知脆弱 plugin corpus の contamination 対策

## 出典

- [Wordfence — Wordfence Argus: Moving Beyond Human Research Capability (2026-08-27)](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)
- [Google Cloud / Mandiant — Staying Ahead of Adversarial AI Through Agentic Source Code Review (2026-08-18)](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
- [Anthropic — Defending Code Reference Harness: Best Practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
