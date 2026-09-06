# Knowledge: reference harness comparison

Status: official-source maintenance comparison, checked 2026-09-06

## Conclusion

**Inference:** 6〜12か月のproduct寿命を考えても、参照Harnessの工程図へ全面改築する根拠はない。既存のcontext境界を起点に、正本データ、表示、schema互換、復旧の責任を段階的に整理する方が妥当である。小さな見た目の整理だけで十分という意味ではない。callerが保存形式や旧世代の状態を知る必要がある境界は、独立した受入条件で構造を見直す対象になる。

比較で直接役立つのはCodex Securityのcanonical contractとprojectionの分離、Anthropicの明示的な失敗分類、両者の境界を検証するtestである。stage数、Module数、総LOCは保守性の証明にならない。AVDHとCloudflareの記事は評価観点の根拠にはなるが、非公開のInterfaceや復旧保証の実装根拠にはならない。

このnoteは外部根拠と推論を記録する。設計採用、現行実装の一覧、次の作業の正本はそれぞれ[Architecture](../ARCHITECTURE.md)、[Codebase Guide](../CODEBASE-GUIDE.md)、GitHub Issuesとする。

## Evidence boundary

「Observed / code」は固定commitの実装・testを静的に確認した事実、「Observed / docs」は公式文書の記述、「Observed / article」は提供者の記事による説明・自己申告、「Inference」はこのrepositoryに対する判断である。testの存在と実行成功は区別する。

| Reference | Verified source | Evidence limit |
| --- | --- | --- |
| OpenAI Codex Security | [`c8296885fbbf593edc1b405dc49859496b2bd8e4`](https://github.com/openai/codex-security/tree/c8296885fbbf593edc1b405dc49859496b2bd8e4)、2026-09-04 commit。調査時のHEADと一致。 | 公開SDK / pluginのcodeを確認できる。WordPressでの性能や6〜12か月の保守保証は示さない。 |
| Anthropic Defending Code Reference Harness | [`d3bea6b5793b5f3d59a75ebe69a58efa88383145`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145)、2026-08-06 commit。調査時のHEADと一致。 | [README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md#L12-L39)は保守終了とC/C++ memory-safety向けreferenceであることを明記。managed Claude Securityの実装を表すものではない。 |
| Google / Mandiant AVDH | [公式記事、2026-08-18](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) | 内部のpoint-in-time architectureと評価方法の説明。この記事から公開source、永続化schema、障害注入test、benchmark datasetは検証できない。 |
| Cloudflare | [Harness記事、2026-06-18](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)、[VDR記事、2026-09-03](https://blog.cloudflare.com/vulnerability-discovery-remediation/) | 内部運用の説明と顧客向けservice方針。記事の図や実績値から非公開Moduleの実装品質を推定しない。 |

## Public code: Interface, state, recovery

| Concern | Observed | Inference for maintenance |
| --- | --- | --- |
| Canonical dataとprojection | **Docs + code:** Codex Securityはmanifest、findings、coverageをsealed observationとし、可変のlifecycle情報をconsumer側へ分離する。report / exportはprojection。[Contract](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L5-L38)と[finalizer](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/scripts/finalize_scan_contract.py#L2799-L2845)の両方で確認できる。既sealedの再処理はcanonical JSONを変更しない。 | readerごとに別の意味を再構築させず、表示を再生成可能にすると互換性の管理箇所を絞れる。ただしこのterminal bundleは進行中のworkflow stateやLedgerを置換するものではない。 |
| Consumer Interface | **Code:** Codex Securityの[ScanResult](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/sdk/typescript/src/result.ts#L36-L127)はtyped manifest / findings / coverageとartifact位置、usage-derived costを公開する。**Docs:** reportは既存Markdownを意味の復元元にせず、optional field欠落時にもcanonical JSONから決定的に生成する。[Compatibility](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L165-L183) | 外側が狭いこととModuleが深いことは別である。callerが保存世代やreport解析を知らずに必要な結果を得られるかを評価する。SDKの全機能を移植する必要はない。 |
| Stopとnegative result | **Docs:** Codex Securityはcompleted / failed / canceled / interruptedを区別し、停止時のFinding不在を結論にしない。cancel後は凍結済みsource setだけが対象になる。[Terminal semantics](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/scan-contract.md#L29-L48)。**Code:** late workerが停止結果のsealを変更しない[process-boundary test](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/sdk/typescript/tests-ts/stopped-scan-results.test.ts#L203-L232)がある。 | 保存済み観測、実行終了理由、再開可能性を一つの成功flagへ潰さない。resumeの受入条件には遅着結果と停止済み結果の不変性も含められる。 |
| 小さなstage contractの利点と限界 | **Code:** Anthropicは[stage dataclass](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/artifacts.py#L15-L62)と[RunResult](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/artifacts.py#L150-L192)で受け渡す。ただし[checkpoint loader / writer](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/cli.py#L145-L201)はCLIにあり、statusは文字列、serialisationはdict変換である。 | 小さなartifactは読解を助けるが、型があるだけでruntime validationやversion互換を満たすわけではない。短いreferenceをproductionの安定したModule Interfaceと同一視しない。 |
| Failure分類 | **Code:** Anthropicの[agent wrapper](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L363-L422)はturn上限、error result、terminal resultのないstream終了、死んだcontainerを区別する。[Checkpoint](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/cli.py#L145-L165)はagent / build failureを完了済み扱いにしない。 | transport成功、モデルの完了、domain上の結論を別々に扱うことは、provider変更後も再利用できる保守上の性質である。retry回数や具体的なstage順序まで借りる根拠にはならない。 |
| Durabilityの説明と実装 | **Code:** Anthropicの[冒頭コメント](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L10-L20)はtranscriptをfsyncすると説明するが、[実際のwriter](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L340-L347)はflushのみ。[Result writer](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/cli.py#L182-L201)も直接JSONを書き込む。 | transcriptを残すことから電源断耐性や原子的checkpointを推定できない。debug streamの観測性と再開時の正本を分け、保証を説明する箇所と実装を対応させる。 |

## Isolation and test evidence

| Reference | Observed | Limit / reusable lesson |
| --- | --- | --- |
| Codex Security trust boundary | **Docs:** [SECURITY.md](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/SECURITY.md#L39-L90)はlocal OS account / Git / selected toolsを信頼境界の前提とし、同じaccountを使うjob同士の隔離を保証しない。subprocessへ一部ambient credentialが残ることも明記する。 | WordPressのuntrusted package向け隔離契約と同等とは言えない。artifactの完全性、OS隔離、権限、credentialの分離は別の保証である。 |
| Anthropic isolation owner | **Code + docs:** [agent_container](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/sandbox.py#L59-L98)がcontainer lifecycleを集約し、[公式文書](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/agent-sandbox.md#L7-L42)はgVisorとnetwork allowlistの役割を分ける。一方、[provider credentialはagentから見える](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/agent-sandbox.md#L79-L97)構成である。 | lifecycleを一箇所で所有する設計は参考になる。具体的な権限設定やcredential配置の移植は、現行security invariantを満たす根拠にならない。 |
| Codex Security tests | **Docs + code:** [Testing guide](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/sdk/typescript/TESTING.md#L47-L74)はobservable failure / cleanupと、filesystem / Git / SQLiteの実境界を選んで検証する。前節のlate-worker testはPython subprocessを通す。 | coverage率やtest件数より、schema互換、再開、停止、再読込みの契約を外側から観測できるかが重要。今回testは実行していない。 |
| Anthropic tests | **Code:** [agent failure tests](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/tests/test_agent.py#L85-L158)と[checkpoint tests](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/tests/test_checkpoint.py#L19-L54)がある。実infraの[isolation tests](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/tests/test_agent_sandbox.py#L3-L31)は明示的なopt-inで通常suiteから除かれる。 | private helper testやmockされたprocess testだけでは実環境の保証にならない。testが存在する、通常gateで走る、対象環境で通った、の三つを区別する。 |

## Article-only comparisons

| Reference | Observed / article | Inference and limit |
| --- | --- | --- |
| AVDH: architecture | ADKによる逐次phase、consultantによるThreat Model確認、domain / language / framework等の知識の階層を説明する。[Architecture](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#architecting-the-pipeline)、[Distilled knowledge](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#distilled-knowledge) | 方針や知識のownerを明示する着眼点は再利用できる。工程図からModule Interfaceの狭さ、state ownership、failure semantics、変更localityは分からない。waterfall構成の採用根拠にはしない。 |
| AVDH: evidence quality | 非公開synthetic benchmark、埋込み欠陥の人間確認、AI gradingの人間監査、複数回の評価を説明する。[Measuring success](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#measuring-success) | ground truthと採点者の品質を別々に検証する観点は有用。記事の実績は再現した測定ではなく、公開datasetの暗記問題を避ける方針だけで将来のWordPress recallを保証しない。 |
| Cloudflare: recovery | 各stageの結果をSQLiteへ保存し、中断後に再利用すると説明する。また成功HTTP stream内のerrorを完了扱いした経験を報告する。[Persistence and errors](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#codifying-the-skill-into-a-pipeline) | 永続化とsemantic completionを先に考える動機は分かる。SQL schema、transaction、再開時の照合やcrash testは記事から確認できず、「失うのはin-flight taskだけ」という保証を実証済みと扱わない。 |
| Cloudflare: measurement | validation通過数、人間へ届く未確認結果、held-out repositoryでの変更比較を指標とし、推測recallを中心指標にしない。[Evaluation](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#how-we-tell-its-working) | lifetime funnelや一repoの例は同一条件の比較試験ではない。母集団、対象、モデル、判定基準が異なる数字をWordPressのFP率、recall、cost baselineへ転用できない。 |
| Cloudflare VDR: authority | source evidenceで存在を裏付け、production contextを優先度へ使う。tool callと提案をmodel外で検査し、曖昧な結果を診断へ回し、顧客がtest / deployを判断すると説明する。[Context](https://blog.cloudflare.com/vulnerability-discovery-remediation/#adding-context-to-a-vulnerability-harness)、[Execution and review](https://blog.cloudflare.com/vulnerability-discovery-remediation/#where-the-model-runs) | 技術的観測、運用上の優先度、外部変更の権限を別にする観点を支持する。記事からexact draft revisionへの承認bindingや監査recordの実装までは確認できない。 |

## Local measurement: initial stop and source follow-up

以前の「Root Evaluation前で停止した一回だけ」という記述は最新の公開実測を表さない。同じimmutable targetに対する、初回と別途承認されたsource follow-upを区別する。出典は[#109初回sanitized outcome](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/109#issuecomment-5553789772)と[#109 source follow-up outcome](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/109#issuecomment-5557161663)。

| Public observation | Initial run | Source follow-up |
| --- | --- | --- |
| Completed model Attempts | 3 / 3 | 6 / 6 |
| Durable checkpoints | 13 | 21 |
| Root Evaluation / fresh Validation | 0 / 0 | 1 / 1 |
| Immutable source-validated Finding | 0 | 1 |
| Coverage | unknown、budget-exhausted | incomplete / research-work-remains |
| Tokens / estimated provider cost | 3,976,741 / USD 7.1014455 | 8,074,223 / USD 13.9636 |
| Ledger / CAS close-reopen | replay一致 | replay一致 |
| Runtime / Human Verification | 未着手 | 未着手 |

**Observed / public outcome:** follow-upはsource-onlyの縦sliceを完了したが、target codeの実行、runtime verification、人間による再現、外部提出は行っていない。Findingの存在はCoverage Closureを意味しない。private evidenceの内容はこのnoteへ含めない。

**Inference:** これはlifecycleとreplayが一例で通った証拠であり、high-impact recall、false-positive率、runtime成立率、人間負荷の比較値ではない。二回は途中の修正と条件が異なるため、cost差も効率改善・悪化の証明には使えない。現在の実装対応はCodebase Guideを参照する。

## Reusable maintenance judgement for 6–12 months

以下は採用済み設計ではなく、上の比較に基づく判断材料である。

1. **全面rewriteを選ぶ理由は不足している。** Codex Securityはconsumer向けcanonical contract、Anthropicは狭い用途のreference、AVDH / Cloudflareは内部運用であり、どれも現行productの代替実装ではない。特に保守終了のreferenceを取り込むと、互換性と修正の責任も引き受けることになる。
2. **段階的な構造整理には根拠がある。** 正本recordとprojection、current writeとlegacy read、実行終了とdomain outcomeの責任がcallerへ漏れている場合は、その境界一つを受入条件にして整理する。旧artifactを再読込みできることとcurrent pathのInterfaceが単純になることを同時に確認する。
3. **最小化の単位はModule数ではなくcaller knowledgeにする。** 外側APIが短くても、内部callerが保存順、旧schema、provider streamを知れば変更が広がる。逆に一つのownerがこれらを隠し、public seamから成功・失敗・再読込みを検証できるなら、内部のcode量だけで浅いModuleと断定しない。
4. **保証はtestと観測に結びつける。** crash recovery、schema互換、late result、隔離、承認bindingは異なる性質である。公式文書の表現やdefault suiteの成功だけで一括して保証せず、どの境界をどの条件で確認したかを残す。

調査では固定commitのsource / tests / docsと公式記事だけを読んだ。参照Harnessのinstall、build、test、scan、target runtime、model呼出しは実行していない。
