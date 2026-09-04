# アーキテクチャ概要

Status: accepted design overview, 2026-09-03

## 1. System context

```mermaid
flowchart TB
    operator["Human Operator"]
    feeds["Target Sources"]
    ti["Target Intelligence"]
    intake[["Target Intake Packet"]]
    research["Research"]
    packet[["Human Review Packet"]]
    human["Human OS"]
    reports["External Reports"]

    feeds --> ti --> intake --> research --> packet --> human
    operator --> ti
    operator --> research
    operator --> human
    human -->|"authorize"| reports
```

`Target Intelligence`は対象を選定・取得し、oracleを除いたIntakeをResearchへ渡す。`Research`はhigh-impact semantic discovery、conditional Depth、独立Verification、記録を所有する。`Human OS`はFinding後のreviewと外部行動の明示承認を所有する。

三つのcontextはversioned handoff contractだけで接続する。Target Intelligenceの取得内部状態をResearchから直接読まず、Researchのmodel sessionやstorageをHuman OSから直接読まない。Intake PacketとHuman Review Packetがそれぞれの境界で必要な事実を固定する。

最初のproduct goalは、手動投入した最新TargetのProspective CampaignからHuman Confirmationまでを閉じることである。External Reportの送信は到達条件に含めず、別のExternal Action Authorizationを必要とする。

## 2. 一つのTargetを処理する流れ

上のcontext図を、実際に一件のTargetが通る順番へ直すと次のようになる。この節はsystem全体の流れだけを説明し、各Moduleの細かなcontractは繰り返さない。

1. **ターゲットを一つ選ぶ。** 最初は人間がprogramme条件を満たす最新のWordPress pluginを選び、将来はTarget Intelligenceが同じ条件で候補の収集と順位付けを支援する。既知脆弱性の答えはResearchへ渡さない。

2. **調べるsourceを固定する。** 取得したpluginのidentity、version、全fileのdigest、設定、取得元を一つのTarget Intake Packetへ固定する。以後の判断と証拠は、すべてこの同じTargetを参照する。

3. **安全な再現環境を準備する。** 固定したTargetを隔離Labへinstallし、activateと最小限の動作確認を行う。環境を再現できなければ脆弱性なしとはせず、setup未完了として止める。

4. **Campaignを開始する。** Harnessがscope、使えるtool、十分に緩い安全上限、並列数、記録先を固定する。AIにはTarget sourceと研究目標を渡すが、見るfileや疑う脆弱性classは先に決めない。

5. **source全体を独立した視点で調べる。** 一つのwhole-target探索とsource-awareな複数の探索を走らせ、入力からsecurity-sensitiveな結果までの壊れた意味を探す。Mapやstatic analysisは補助に使えるが、それらが見つけなかった範囲を安全とは扱わない。

6. **見つけた仮説と断片をすぐ保存する。** 攻撃経路が一つ成立した時点でHypothesisとして独立Verificationへ渡し、まだ足りない経路はRoute FragmentまたはFrontier Gapとして残す。全Finderの終了や多数決を待たない。

7. **一回の探索結果をまとめて判断する。** 新しい証拠、攻撃者の到達可能性、得られる能力、越えるtrust boundary、足りないlinkを整理する。重大HypothesisはVerificationへ、high-impactへ伸びる具体的なfrontierはDepthへ送り、価値ある次の調査がなければ終了候補にする。

8. **有力な仮説を別の担当が検証する。** Discoveryの会話、payload、自己評価を引き継がないfreshなVerifierがsource routeを読み直し、fresh Labで型付けされた実験を行う。攻撃入力でsecurity effectが起きるWitnessと、原因を一つ除くと起きないCausal Controlの両方を要求する。

9. **つながりそうな断片だけを深掘りする。** Depthへ進んだfrontierは、fresh Root Synthesisで経路を接続し、別のAdversarial Criticが前提、actor、state、request順序、防御、因果hopを壊しにいく。具体的に足りない事実が残れば、その一点を調べるfresh Missing-link Waveを行う。

10. **十分な証拠が得られるまで反復し、根拠を持って止める。** 新しいmechanismが得られる限りは探索・統合・批判を反復する。重大仮説をVerificationへ送り終え、approachが尽き、未解決事項と再開条件を記録できた時だけCampaignを閉じる。

11. **独立に実証できたものだけをFindingにする。** FindingはTarget identity、source route、再現可能なExperiment、Witness、Causal Control、限界をdigest固定する。Finderのconfidence、model同士の同意、static ruleのmatchだけでは昇格させない。

12. **人間が確認できるPacketを作る。** ResearchはFindingからHuman Review Packetを作り、raw transcriptなしでも人間が何を再現し、何を確認すべきか分かる形でHuman OSへ渡す。

13. **人間がfreshに再現して確認する。** 人間はPacketとfresh Labから証拠を再確認し、confirmed、追加証拠が必要、または棄却を判断する。ここまで閉じたprospectiveな未知high-impact Findingが最初のproduct goalである。

14. **外部へ出す場合は別に承認する。** Human Confirmationはvendor連絡、submission、公開を自動実行しない。外部行動は対象と内容を示したExternal Action Authorizationを改めて得てから行う。

runtimeで一件のTargetが通る順序と、capabilityを実装する順序は同じではない。開発順は[Capability-first Roadmap](../roadmap.md)、現在動く範囲とBehavior Testは[Codebase Guide](../../CODEBASE-GUIDE.md)を正本とする。

## 3. Research loop

```mermaid
flowchart TB
    target["Target Snapshot"]
    planner["Root Planner"]
    finders["Independent Finders<br/>up to 4"]
    barrier["Semantic Research<br/>Wave Barrier"]
    evaluate{"Root Evaluation"}
    verify["Independent Verification"]
    depth["Depth Admission"]
    synthesis["Root Synthesis"]
    critic["Adversarial Critic"]
    missing["Fresh Missing-link Wave"]
    stop["Evidence-backed Stop"]
    record[("Research Record")]

    target --> planner --> finders --> barrier --> evaluate
    evaluate -->|"重大Hypothesis"| verify --> record
    evaluate -->|"strong frontier"| depth --> synthesis --> critic
    critic -->|"missing link"| missing --> planner
    critic -->|"source-bound route"| verify
    evaluate -->|"no valuable evidence"| stop --> record
```

- raw sourceから探索を開始し、Surface Mapやstatic analysisを探索境界にしない。
- Plannerはresearch thesisを分けるが、Finderのfile、CWE、手順を固定しない。
- 一Waveで閉じる重大FindingはそのままVerificationへ進める。
- high-impact potentialが残る時だけDepthへ追加投資する。
- Synthesis/Criticはsemantic chainを扱い、Finding昇格はfresh Verificationだけが行う。

詳細な探索policyは[Autonomous Research Loop](autonomous-research-loop.md)、三つの運行差は[Semantic Research, Breadth and Depth](breadth-depth-research-loop.md)を参照する。

## 4. Trust zones

```mermaid
flowchart TB
    control["Campaign Control"]
    execution["Model Execution"]
    provider["Model Transport"]
    sandbox["Agent Sandbox"]
    tools["Harness Tool Gateway"]
    target["Target Snapshot"]
    lab["Verification Lab"]
    record[("Research Record")]

    control --> execution <--> provider
    execution --> sandbox --> tools -->|"read-only"| target
    control --> lab
    lab --> record
    execution --> record
```

**Harness owns the research process; agents own research decisions.** Harnessはscope、budget、tool permission、isolation、provenance、persistence、fresh Verificationを強制し、探索先と脆弱性の意味判断を先回りして決めない。

各Moduleのownerは[Module Map](module-map.md)、詳細contractは[Design Documentation](../README.md)からowning Seamへ進む。現在の実装状態は[Codebase Guide](../../CODEBASE-GUIDE.md)だけを正本とする。
