# Exploration seam

Status: accepted, 2026-09-01

## Owner and purpose

ResearchのExplorationが所有する。根拠状態付きSurface Mapから、重複しないFocus Area、異質な探索戦略、source-boundなHypothesis、Focus Area横断chain、証拠付きclosureを作り、次に実行する有限workだけを一つの深いinterfaceの背後へ隠す。

Explorationは脆弱性を実証せず、provider process、Lab、Research Ledgerを直接操作しない。Campaign Controlは探索内部のFinder数、Strategy順、dedup、Chain Synthesis、Gap Reviewを知らず、Model ExecutionとSource Mappingをtyped decisionに従って呼ぶ。

## Interface

```ts
interface Exploration {
  decide(input: ExplorationDecisionInput): ExplorationDecision;
}

type ExplorationDecisionInput =
  | { kind: "bootstrap"; map: SurfaceMapRef; policy: ExplorationPolicyRef }
  | {
      kind: "wave-completed";
      map: SurfaceMapRef;
      state: ExplorationStateRef;
      wave: WorkWaveRef;
      results: readonly AttemptExecutionResultRef[];
    }
  | {
      kind: "map-revised";
      map: SurfaceMapRef;
      state: ExplorationStateRef;
    }
  | {
      kind: "verification-completed";
      map: SurfaceMapRef;
      state: ExplorationStateRef;
      records: readonly VerificationRecordRef[];
    };

type ExplorationDecision =
  | { kind: "run-wave"; plan: WorkWavePlan }
  | { kind: "revise-map"; request: MappingEvidenceRequest }
  | { kind: "verify"; hypotheses: readonly HypothesisRef[] }
  | { kind: "review-gaps"; plan: GapReviewPlan }
  | { kind: "close"; proposal: CoverageClosureProposalRef }
  | { kind: "blocked"; gaps: readonly ExplorationGapRef[] };
```

`ExplorationPolicyRef`はLane/Strategy policy、eligible Model Profile registry、ranking tuple、closure policyをdigest固定する。`decide`は同じ入力refsから同じdecisionとstable orderingを返すpure decisionである。callerはFinder role別method、`runChainSynthesizer`、`reopenFocus`、score更新、model votingを呼ばない。

## Minimum map gate and incremental understanding

全sourceの解析完了をDiscovery開始条件にしない。最初のWork Waveには少なくとも次を満たすSurface Map revisionを要求する。

- 全Target manifest entryのinventoryと未対応理由がある
- 一つ以上の実在するentry、trust transition、state、guard、sink anchorがあるか、それらを得られないgapが明示されている
- observed、inferred、unknownが区別され、source anchorを持たない関係がobservedになっていない
- Focus Areaの所有keyに使えるsurface anchorがstable identityを持つ

Discovery開始後もContext Request、Runtime Observation、Finderが見つけた新しいasset relationからSource Mapping revisionを要求できる。revisionは既存Work Waveの入力を変えず、次のdecisionから適用する。

各Focus Areaには、対象機能、利用actor、必要privilege、重要state transition、想定security invariantを短い型付きbriefとして持たせる。単一sinkの列挙だけを探索開始点にしない。

## Lane and Strategy are different axes

Exploration Laneは「なぜ調べるか」を表す。

- Frontier Lane: primitiveをchainし、RCEまたは同等のsite-wide compromiseへ近づける
- Primitive Lane: SQL injection、Stored XSS、authorization、identity、file、path等の独立impactを探す
- Coverage Lane: 未所有surface、unknown relation、parseまたはmapping gapを閉じる

Exploration Strategyは「どう調べるか」を表す。初期Strategy Portfolioは次の五つとする。

1. entry順方向: attacker-controlled inputからguard、state、sink、impactへ追う
2. sink逆方向: code execution、file write、query、render、privileged actionから到達可能なinputへ戻る
3. state-chain: write/read、actor交代、cross-request、保存identity、時間順を追う
4. 権限・security invariant: 正常なFeature、Actor、Privilege、State Transitionから破壊可能な不変条件を探す
5. Wildcard: 既知classまたはsink catalogに開始点を固定せず、source-boundな意外なrouteを探す

Lane、Strategy、model family、worker roleを一つのenumへ潰さない。vulnerability classごとのFinder interfaceを作らず、共通Finder roleと共通Output Schemaへversioned Strategy Profileを与える。

eligibleな各Work Waveには非ゼロのWildcard枠を持たせる。高リスクsurfaceまたはFrontier候補は、可能な限り異なるmodel familyと異なるStrategyで二系統以上に割り当てる。それ以外はsurface ownershipを分割してcoverageを優先する。割合、重複数、Hypothesis上限はinstrumented pilotで決める。

## Finder contract

Finderの正本outputは次の型付きartifactだけとする。

- Source-bound Hypothesis
- Context RequestまたはRuntime Observationを必要とするMapping Evidence Request
- Closure Record
- Route Fragment Proposal

自由文レポート、model confidence、重大度の自己申告、scanner matchだけを受理しない。Hypothesisは少なくともPermitted Attacker、破壊するsecurity property、Evidence Route、observed anchor、inferredまたはunknown gap、falsifier、次の決定的観測を持つ。cross-request routeはstate write、state read、保存identity、actor、順序を分ける。

一Focus Areaから類似候補を無制限に生成せず、Causal Identityとroute shapeでdeduplicateする。ただし支持model数を採否に使わず、一つのmodelだけが示したHypothesisもsource-boundかつ反証可能なら残す。criticまたはSynthesizerはfalsifierと不足証拠を追加できるが拒否権を持たない。

## Independent work and Chain Synthesis

Finderは別Finderのconversation、scratch、payload、進行中outputを読まない。同じ高リスクFocus Areaへ複数Attemptを割り当てる場合もfresh contextと異なるStrategyを使う。結果は完了順に記録してよいが、全Attemptがterminalになるまで統合しない。

Work Wave barrier後に、結果をstable Work ID順でfoldしてChain Synthesisを行う。入力は型付きRoute Fragment、Hypothesis、state transition、negative evidenceだけであり、raw transcriptではない。Chain Synthesisは次を行う。

- 別Focus Areaのprimitive間に必要なactor、state、capability、trust transitionを照合する
- ATO、Stored XSS、SQL injection、file primitive等を新しい権限またはexecution capabilityとしてFrontier routeへ戻す
- 接続に必要な未知relationをFrontier Gapとして作る
- 同じCausal Identityの重複をまとめるが、相反するrouteをconsensusで消さない

接続済みgraphは新しいHypothesisでありFindingではない。既存Route Fragmentのobserved範囲を越えるedgeとterminal impactは個別に反証可能でなければならない。

## Mapping evidence and Runtime Observation

静的に決められないdynamic hook、callback、registration、dispatch、state transitionは推測でobservedにしない。Explorationは必要な決定と情報利得を持つMapping Evidence Requestを返し、Source Mappingがsource Context RequestまたはRuntime Observation Planへ変換する。

Runtime Observationはfresh Lab Baseline cloneで許可された低影響操作だけを実行し、固定request、観測対象、成功条件、上限、cleanupを記録する。結果は次のSurface Map revisionのruntime evidenceになれるが、攻撃payload、security property破壊、Witness、Causal Control、Finding promotionには使わない。FinderへLab、HTTP、browser、shellを渡さない。

## Ranking and verification handoff

Exploration Queueはopaque scoreまたはmodel confidenceではなく、次のversioned tupleをstable orderで比較する。

1. terminal impactとPermitted Attacker
2. observed Route Fragmentとessential gapの具体性
3. 次の観測が支持または反証を決める情報利得
4. 検証費用と残budget
5. noveltyと既知Causal Identityとの差
6. coverage debt

Wordfenceの誤検出基準はDiscoveryの候補生成を禁止するchecklistにせず、Hypothesis生成後のPreflightとVerificationで具体的falsifierとして使う。static rule matchはHypothesis Seedとして出自を記録し、通常のsource binding、ranking、Preflight、独立Verificationを通す。

blindな全面fuzzingは初期探索へ入れない。source-bound Hypothesisと決定したinput surfaceがある場合だけ、Verificationが限定的なtyped Experimentとしてrequest生成を扱う。

## Closure and reopening

Finderのdoneまたは自由文summaryでFocus Areaを閉じない。Closure Recordは所有surfaceをobserved、Hypothesis化、source根拠付きruled-out、理由付きBlockedへ分類する。

全Focus AreaのClosure Recordが揃った後、freshなGap Reviewerが未所有surface、unknown relation、未追跡state、未解析asset、探索重複を調べる。Coverage Closureには既存ADRどおり独立した二回のgap passを要求する。新しいSurface Map revision、Route Fragment、state transition、dependency evidenceがclosureの前提を変えた場合だけ、該当Focus Areaを新revisionとして再開する。

resource exhaustion、provider failure、Observation不能、未選択HypothesisをCoverage Closureへ読み替えない。

## Failure semantics

- Finder outputがschema不一致またはsource anchorなしならHypothesisへ昇格せず、invalid outputとして記録する。
- 一つのAttemptまたはmodel familyが失敗しても、別Attemptのminority Hypothesisを破棄しない。
- MapperとFinderの主張が矛盾する場合、observed factを維持し、矛盾をMapping Evidence Requestへ変える。
- Runtime Observationが失敗した場合、relationをfalseにせずreason付きunknownまたはBlockedとして残す。
- Chain Synthesisが新しい接続を作れなくても、入力Route Fragmentとprimitive Hypothesisを変更しない。
- Gap Reviewで新しいsurfaceまたはrouteが見つかった場合、Completedへ進まず次の有限Work Waveを作る。

## Test surface

behavior testは`decide(input)`が返すExploration Decisionと、そこから記録される型付きartifactだけを観測する。prompt文章、内部score、model call count、Finder実行順、dedup helper、Chain Synthesisの中間graphを直接assertしない。

固定Surface Map、Attempt outputs、Verification records、policyをfixtureとして使い、少なくとも次を検査する。

1. 同じ入力から同じFocus Area、Work Wave、stable orderingを返す。
2. LaneとStrategyが別軸で割り当てられ、Wildcard枠がeligibleなWaveから消えない。
3. 高リスクFocus Areaの独立Attemptが別Strategyとmodel-family constraintを持つ。
4. 一件だけのsource-bound Hypothesisが多数決で失われない。
5. 相反するrouteが別artifactとして残り、決定的なEvidence Requestが作られる。
6. cross-request chainがwrite/read identityとactor順序を失わない。
7. Runtime Observation resultがSurface Map evidenceにはなってもWitnessにはならない。
8. Semgrep matchがHypothesis Seedを越えてFinding扱いされない。
9. 新しいRoute Fragmentが閉じたFocus Areaの前提を変えた時だけ再開する。
10. independent Gap Reviewが未所有surfaceを見つけた場合、Coverage Closureを返さない。

## Explicit non-goals for the first implementation

- vulnerability classごとのagent hierarchy
- Finder同士のchat、debate、majority vote
- model confidenceまたはlearned black-box ranker
- embedding/vector databaseを前提にしたsource retrieval
- root evidenceのない全面fuzzing
- FinderへのWordPress runtime、browser、network、shell権限
- Runtime ObservationとFinding Verificationの統合

embedding等はdeterministic symbol、graph、source searchで再現可能なcoverage gapが測定された時だけ再評価する。探索以外のUI、notification、multi-user、運用自動化は、安全隔離とevidence integrityに必要な最小限を除き、実戦で壊れた箇所をissue化して改善する。
