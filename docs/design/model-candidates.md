# Model candidates

Status: Candidate set, profile and effort unassigned

初期の評価候補は次の4系統とする。

- GLM 5.3
- Grok 4.6
- `gpt-daybreak-blue-latest`
- Opus 5

これらは設計時の論理名であり、実行時のprovider slug、endpoint、利用可能なeffort、tool capabilityは各adapterの接続時に確認する。候補であることはproduction採用を意味しない。

## モデル可搬性の要件（Model Portability Requirement）

探索、検証、記録のdomain contractを特定provider、model family、effortへ結合しない。Focus Area、Work Lease、harness-owned tool、role-specific output schema、Hypothesis ingestion、Independent Verificationは共通であり、adapterだけがprovider固有の認証、transport、model identity、effort、event形式を吸収する。FinderまたはVerifierというroleをOpus専用の役割として定義しない。

目標は、Transport Eligibilityとrole別の最低能力契約を満たす現在・将来のmodelを、versioned Model Profileとして差し替えられることである。任意の低能力modelが同じrecallを持つことまでは保証しない。一方で、巨大sourceの一括理解、必要fileの推測、出力の自由形式変換、自己検証をmodelの強さへ依存させず、Target固定、Surface Map、Focus分解、bounded read/search/symbol/graph、schema検査、独立Verificationをharness側が負担する。これにより比較的安価なeligible modelでも完全な発見経路を担当できる設計にする。

ハーネスの寄与は同じTarget、model/profile、Focus、予算を固定し、単純な固定source contextとharness-owned toolを使う経路をBoundary Pairで比較する。最終Finding数だけでなく、Target Identity、Map Coverage、Focus Rank、Context Reach、Hypothesis Recall、Verificationの各gateを観測する。強いmodelの単発成功をハーネス能力と読み替えず、安価なProfileで再現するほど深い分解とtoolingを優先する。

初期transport候補は、subscription credentialに公式対応するnative agent processとする。下表は実装予定を示し、Transport Eligibility Receiptが発行されるまでproduction採用を意味しない。

| Candidate | Planned official transport probe |
| --- | --- |
| GLM 5.3 | providerが公式対応するcoding clientと分離profile |
| Grok 4.6 | provider公式headless agent client |
| `gpt-daybreak-blue-latest` | provider公式Codex client |
| Opus 5 | provider公式Claude Code client |

subscription OAuthまたはCoding Plan keyを独自APIへ流用しない。公式配布・公式用途、version固定、credential isolation、built-in tool無効化、structured output、process terminationをprobeできない候補は保留する。API/service credentialを別途導入した場合だけ`DirectApiTransport`を追加する。詳細は[transport research](../research/model-transport-and-subscription-auth.md)と[ADR 0104](../adr/0104-admit-only-official-model-transports.md)に記録する。

初回実装で4系統×全4roleの全組合せをbenchmarkしない。各adapterは共通contract suite、capability probe、一つの小さなBoundary Pair smoke testを通し、実戦Campaignの不足roleへ順次投入する。roleごとの採用は実戦のquality、誤昇格防止、coverage、cost、latency、varianceから更新する。

adapter実装順はmodel評価と分ける。最初のvertical sliceはTransport Eligibilityを通過したClaude process/Opus Profile一つで完走させ、次にGLM、Codex、Grok候補を個別probe後に接続する。これはbootstrap順であり、Opusを各roleの恒久的な採用modelとみなす判断ではない。bootstrap順は[ADR 0069](../adr/0069-bootstrap-with-the-claude-process-adapter.md)、適格性条件は[ADR 0104](../adr/0104-admit-only-official-model-transports.md)に記録する。

採用は次の小さなcycleで行う。

1. provider capabilityと共通contractを確認する
2. Boundary Pair一件で、対象roleの出力と誤昇格防止が壊れていないか校正する
3. 少数の実戦Campaignへversion固定して投入し、永続artifactからrole適性を判定する

effortはprovider間で共通名称へ正規化しない。初期Profileは`provider-default`を明示し、実戦で特定roleのcostまたは品質がボトルネックとなった場合だけ、隣接設定を小さな比較で評価する。Claude Opusの`high`は開発時の比較baselineであり、システム共通のdefaultではない。

全Profileの一律3回反復は要求しない。実戦で比較可能なnatural replicateを蓄積し、Frontier roleの採用やコストの大きい変更など、varianceが意思決定を変える場合だけ対応を固定してreplicateする。

Profileごとに実測して決める値:

- 実戦証拠蓄積後のroleごとの採用model
- model/role固有effort、context ceiling
- wall、turn/tool、output、process、retry ceilingの具体値
- provider client version、credential expiryと再認証運用
- 小さなsmoke cohortと実戦canaryの昇格threshold

tool policyの構造は決定済みであり、harness所有のrole別manifestだけを公開する。具体的なtool集合とceilingは各Model Profileでversion固定し、provider組込みshell、web、plugin、hook、ambient MCPは許可しない。詳細は[Model execution seam](model-execution-seam.md)と[ADR 0105](../adr/0105-expose-only-harness-owned-attempt-tools.md)に記録する。
