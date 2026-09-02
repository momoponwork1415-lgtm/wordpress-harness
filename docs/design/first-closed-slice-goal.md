# First closed vertical slice goal

Status: confirmed objective, 2026-09-02

## Goal

Brizy 2.8.11（既知positive）と2.8.12（actual patched negative）のprivate Development Boundary Pairを使い、Finderへ既知脆弱性のoracleを渡さず、固定入力から独立Verificationと次iterationまでを一つの公開入口で自律実行できる最初のproduction-quality closed vertical sliceを完成させる。

```text
Target Snapshot + Surface Map
  -> finite Work Wave
  -> eligible Claude Opus Finder
  -> Source-bound Hypothesis
  -> independent Verification
  -> browser Witness + sibling Causal Control
  -> Finding | Disproved | Blocked
  -> Research Ledger replay
  -> Iteration Decision
```

このGoalの完了条件は`Closure Gate`一つである。Brizyだけでresearch lifecycle、安全隔離、証拠、記録、replayを閉じる。Interfaceを変えない追加Caseへの転用は、閉路完成後の独立した`Transfer Plan`として扱い、このGoalを水平framework実装で遅らせない。

このGoalは早期実戦投入のための小さな能力校正であり、使い捨てprototypeではない。半年から一年以上保守できるstrict TypeScriptのModule、versioned runtime schema、決定的replay、private artifact分離を維持する。大規模なmodel比較または全portfolio benchmarkは要求しない。

これは既存Milestone 1と[ADR 0071](../adr/0071-gate-milestone-one-on-one-complete-boundary-pair.md)の境界を維持する。SQL injection、account takeover、他provider、全cohort評価はこのGoalへ含めない。

## Fixed Boundary Pair

private graderだけが次のCase roleと期待結果を知る。

| Snapshot | Case role | 期待する限定的結論 |
| --- | --- | --- |
| Brizy 2.8.11 | vulnerable positive | 固定HypothesisについてFinding promotion条件が成立する |
| Brizy 2.8.12 | actual patched negative | 同じCausal IdentityについてDisprovedになる |
| benign functional control | normal-function control | 対象機能が利用可能で、Causal Controlの差分が一つに限定される |

Mapper、Finder、VerifierへCase role、CVE、advisory、affected version、patch narrative、既知file・symbol・parameter、既知payloadを渡さない。production codeへBrizy固有のsymbol、route、payload、期待結果を分岐として埋め込まない。

2.8.12のDisprovedは、固定HypothesisとCausal Identityについて必要条件またはsecurity-property破壊が成立しなかったという限定的結論である。plugin全体に脆弱性がないという結論へ拡張しない。

## Post-goal Transfer Plan

以下はClosure Gateを通したproduction経路の次期移植候補であり、このGoalのDefinition of Doneではない。Case情報を残す一方、未実装mechanismやholdout評価を現在の完了判定へ混ぜない。

### User-provided Development Cohort

BrizyでClosure Gateを通した後、次の公開済みCaseをprivate Boundary Pairへ構築する。各positiveには原則として公開情報が示すlatest affected versionを使い、actual patched releaseとbenign functional controlを対にする。

| Case | Positive | Patched negative | Required Experiment |
| --- | --- | --- | --- |
| Brizy unauthenticated Stored XSS | 2.8.11 | 2.8.12 | `stored-xss-browser@v1` |
| TranslatePress Subscriber Stored XSS | 3.2.6 | 3.3 | `stored-xss-browser@v1` |
| Simply Schedule Appointments unauthenticated SQL injection | 1.6.10.0 | 1.6.10.2 | `sql-injection-database@v1` |
| TranslatePress unauthenticated account takeover | 3.3.1 | 3.3.2 | `account-takeover-password-reset@v1` |

公開advisoryはprivate grader、Case admission、期待Causal Identityにだけ使う。Finder、Verifier、production priorityへadvisory情報を入れない。Caseごとのsetup差分はversioned Setup PlanまたはConfiguration Variantとしてprivate workspaceに置き、production sourceへplugin固有分岐を入れない。

### daroo holdout cohort

darooの公開portfolioから、次のStored XSS一件とSQL injection一件を、実装調整に使わないholdout Boundary Pair候補として固定する。選定根拠と一次資料は[daroo public case candidates](../research/daroo-public-case-candidates.md)に記録する。

| Case | Positive | Patched negative | Evaluation value |
| --- | --- | --- | --- |
| WP Statistics unauthenticated Stored XSS | 14.16.4 | 14.16.5 | HTTP input、PHP persistence、admin-side JavaScript consumerを跨ぐ |
| WPGraphQL unauthenticated SQL injection | 2.11.0 | 2.11.1 | GraphQL loaderからdatabase query constructionを跨ぐ |

次を満たした時点でprivate graderをfreezeし、holdoutへadmitする。

- official vulnerable sourceとactual patched sourceを正規入手できる
- private Labでpositive、patched negative、benign functional controlを人間再現できる
- user-provided Development Cohortと異なるplugin familyまたはroute shapeを持つ
- Case role、version、advisory、symbol、parameter、payload、patchをworker-visible inputから除外できる

holdoutをfreezeした後は、そのCase固有のprompt、rule、Knowledge、priority調整を行わない。不成立時は失敗した能力とevidence gapを記録し、同じCaseへ答えを埋め込んで合格させない。

## Definition of Done

次の条件をすべて満たした時だけGoalを完了とする。

1. 一つのResearch公開Interfaceから、固定Target Snapshot、Surface Map、Campaign policy、予算を与えて閉路を開始できる。
2. 2.8.11では最大3回の独立Finder Attempt以内に、実在source anchor、attacker premise、security property、反証条件、次Experimentを持つSource-bound Hypothesisを少なくとも一つ生成する。
3. FinderはTransport Eligibilityを満たす固定Claude Opus Model Profileを使い、provider built-in web、shell、subagent、ambient MCP、plugin、hookを利用しない。
4. VerificationはFinderのsession、transcript、scratch、payload、confidence、priority、worker identityを受け取らず、固定sourceからrouteとattacker premiseを再導出する。
5. 2.8.11ではgVisor上のfresh Verification Labでbrowser Witnessを観測し、同じsealed Lab Baselineから作ったfresh siblingでCausal Controlを実行する。
6. WitnessとCausal ControlはTarget Snapshot、Runtime Profile、Setup Plan、baseline digest、Configuration Variant、Experiment adapter versionを固定し、宣言した一つのcausal factor以外を同一にする。
7. すべてのpromotion gateを満たした2.8.11だけをFindingへ昇格する。model verdict、static match、Runtime Observationだけでは昇格しない。
8. 2.8.12では同じmechanism、Experiment adapter、設定方針を使い、固定Hypothesisについて証拠付きDisprovedを返す。gVisor、setup、browser、provider、evidence不足はDisprovedではなくBlockedにする。
9. Boundary Pairのbenign functional controlが成立し、patched negativeまたはCausal Controlを機能破壊による見かけ上のnegativeと取り違えない。
10. Finding、Disproved、Blockedはversioned discriminated unionとしてruntime decodeされ、private Witness、payload、transcript、credential値はpublic viewまたはGitへ出さない。
11. Campaignのeventとartifact refを追記型Research Ledgerへ記録し、process相当のclose/reopen後に同じCampaign view、outcome、Iteration Decisionを決定的にreplayできる。
12. terminal evidenceをstable orderでfoldし、少なくとも`stop-boundary-pair-complete`、`continue-unresolved-work`、`blocked-capability`を区別する次Iteration Decisionを記録する。
13. crash境界、unknown event version、artifact digest不一致、budget exhaustion、gVisor unavailable、sibling不成立を安全側のtyped outcomeまたはread rejectionとしてBehavior Testで保護する。
14. `pnpm check`、secret scan、GitHub CIが成功し、Codebase Guide、Module図、Seam文書が実装と一致する。
15. private Target、prompt、transcript、payload、credential、未公開Findingをcommitせず、検査済みcommitを`main`へpushする。

## Required evidence

完了判定では、意図または狭いunit testで代用せず、次の証拠を確認する。

| Requirement | Authoritative evidence |
| --- | --- |
| 公開閉路 | Research公開Interfaceから実行するBehavior Testとprivate run receipt |
| oracle-free Finder | render済みinputのpolicy auditとprivate grader分離検査 |
| positive | 2.8.11のsource re-derivation、browser Witness、sibling Causal Control refs |
| patched negative | 2.8.12の同一Causal Identityに限定したDisproved record |
| benign control | normal-function observationとeffective configuration digest |
| replay | close/reopen Behavior Testと同一view digest |
| safety | gVisor identity、no-fallback receipt、secret scan |
| maintainability | accepted Seam、strict TypeScript gate、Codebase Guide同期 |
| delivery | `pnpm check` output、pushed commit、successful GitHub CI run |

## Explicit non-goals

- UI、Remote Control、notification、multi-user
- Wordfence Target Intelligence APIの自動取得と自動対象選定
- Claude以外のprovider adapterまたはprovider fallback
- RCE、file、deserialization、authorization専用Experiment adapter
- WordPress theme、WordPress Core、WordPress外の一般化framework
- Brizy以外のCaseへ未使用の抽象化、完全なbenchmark suite、大規模model比較
- plain Docker、host target execution、手動でのFinding昇格

## Checkpoints

1. [Verification seam](verification-seam.md)をacceptedにし、public test surfaceを固定する。
2. 合成fixtureで`Finding | Disproved | Blocked`とsibling invariantをred-greenする。
3. Research LedgerへoutcomeとIteration Decisionを接続し、close/reopen replayをred-greenする。
4. gVisor Runtime Profileとsealed Brizy Lab Baselineをprivate環境で成立させる。
5. private 2.8.11 positiveと2.8.12 patched negativeを同じoracle-free `CampaignRunner.run`へ通し、positiveだけがFindingになることを確認する。positiveで確定したCausal Identityはprivate graderから同じVerification seamへ直接渡し、2.8.12のDisprovedとbenign controlを確認する。既知Hypothesisをnegative Finderへ渡さない。
6. 全gate、文書同期、secret scan、push、CI成功を確認する。

Closure Gate完了後は、上のPost-goal Transfer Planを別Goalとして開始する。順序はmechanismを一つずつ実Target駆動で追加し、Development Cohort、freeze済みdaroo holdoutの順とする。
