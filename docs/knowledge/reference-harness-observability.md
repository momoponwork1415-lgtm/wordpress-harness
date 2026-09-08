# Knowledge: reference harness comparison

Status: official-source comparison, checked 2026-09-07

## Conclusion

**Inference:** wp2shell / Cycle Double Cover Promptの強みは、固定pipelineではなく、root agentが複数の考え方を使い、途中の手掛かりを統合・反証し、具体的な次手がある限り探索を続ける点にある。旧local v7はこの過程をFinder、Wave、Depth、typed frontierへ分解しすぎ、agentの研究判断をHarness codeへ戻していた。

現行Local Harnessはその分解を撤回した。Provider-native root / subagentへ探索判断を戻し、HarnessにはTarget / Prompt / Runtime / Permission / Budget binding、gVisor、append-only Receipt、fresh Independent Validation、Finding / Coverage分離、人間の外部行動gateだけを残す。この単純化で探索力が維持されたかは設計からは分からず、oracle-separated boundary testとprospective Campaignで測る必要がある。

このnoteは外部根拠と推論を記録する。採用設計は[Architecture](../ARCHITECTURE.md)、現在の実装は[Codebase Guide](../CODEBASE-GUIDE.md)、次のworkはGitHub Issuesを正本とする。

## Evidence boundary

「Observed」は固定commitのsource / docsまたは提供者の公式記事から確認した事実、「Inference」はこのrepositoryへの判断である。記事だけから非公開schema、recovery、性能またはWordPress recallを推定しない。

| Reference | Verified source | Limit |
| --- | --- | --- |
| wp2shell / CDC | [wp2shell exact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)、[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf) | 肯定解とRCE goalを持つ実験。oracle-free prospective recallを直接示さない。 |
| OpenAI Codex Security | [`c8296885f`](https://github.com/openai/codex-security/tree/c8296885fbbf593edc1b405dc49859496b2bd8e4) | 公開SDK / pluginの構造。WordPressでの性能を示さない。 |
| Anthropic Defending Code Reference Harness | [`d3bea6b57`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) | 保守終了済みのC/C++ memory-safety reference。 |
| Google / Mandiant AVDH | [公式記事](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) | 内部architectureの説明。公開codeやdurability testはない。 |
| Cloudflare VDH / VVS | [Harness記事](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)、[VDR記事](https://blog.cloudflare.com/vulnerability-discovery-remediation/) | 内部運用の説明。非公開implementationは検証できない。 |
| Aikido known-CVE benchmark | [2026-08-21 benchmark](https://www.aikido.dev/blog/ai-model-benchmarks-aug-21-2026) | 固定したAikido Harness内で探索modelだけを比較。dataset、target revision、prompt、tool、判定記録は非公開で、Harness間比較ではない。 |
| Wordfence PRISM / Argus | [PRISM profile](https://www.wordfence.com/threat-intel/vulnerabilities/researchers/prism)、[breadth / depth記事](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/) | WordPressでの発見例と運用方針。prompt、model、実装、missを含むrecall datasetは非公開。 |
| Unit 42 NOVA | [公式記事](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/) | 内部Harnessの集計と14-project model比較。公開source、target一覧、candidate判定記録はない。 |

## What each method treats as the frontier

| Method | Frontier | Who decides the next move | What completion means |
| --- | --- | --- | --- |
| Static / dataflow | query authorが定義したsource、sink、flow model内のpath。[CodeQL path query](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) | query / model author | 選択queryが抽出model内を完走。未知semantic bugの不在ではない。 |
| Coverage-guided fuzzing | concrete input corpusと新しいruntime edge / state。[AFL++ approach](https://aflplus.plus/docs/afl-fuzz_approach/) | fuzzerがmutation、人がharness / oracle / Budget | crashやcoverage停滞。business-logic bugには別oracleが必要。 |
| Manual semantic research | security assumption、workflow、state transitionに対する更新中の仮説。[OWASP business logic testing](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/10-Business_Logic_Testing/00-Introduction_to_Business_Logic/) | researcher | 具体的な次手がなくなるまで。機械的closure proofはない。 |
| Agent-led semantic research | modelがsourceから作る仮説、counterevidence、remaining question | root agent / native subagent | AIがactionable frontierなしと判断し、Harnessがfailureやpending Validationがないことを確認。 |

**Inference:** agentic Harnessはstatic analysisやfuzzerを単にLLMへ置換したものではない。manual researcherが頭の中で持つfrontierをagent conversation、packet、cellまたはdurable artifactへ移す。どの表現を選んでも「全fileを触れた」「全cellが一度空になった」「runをunionした」は未知のbroken security semanticsを尽くした証明にならない。

## wp2shell, old local v7, current local harness

| Concern | wp2shell / CDC | Old local v7 | Current local harness |
| --- | --- | --- | --- |
| Goal | 肯定解を保証し、wp2shellはpre-auth RCEへ到達する | oracle-free、SQLi / Stored XSSも保持 | oracle-free、SQLi / Stored XSSは単独でValidation Candidate |
| Agent topology | rootが最大数の範囲でagentを動的利用 | HarnessがFinder数、role、Wave、Depthをmaterialize | provider-native rootがsubagent数と役割を決める |
| Frontier | root conversation内のapproach、blocked route、missing link | Hypothesis、Fragment、Family、Gap等をHarness schema化 | Research Reportのcandidate、next action、Validation feedbackだけをdurableに渡す |
| Iteration | rootがsynthesize、challenge、redirect | fixed Wave / Depth transition | AIの`continue` / `stop`だけ。Depthというphaseはない |
| Validation | adversarial reviewと最終的な人間のruntime確認 | fixed evaluation / rubricを複数stageへ分解 | 一つのfresh source-only Validation。`source-validated`だけがFindingを作る |
| Isolation / record | Prompt自身はhost authorityやdurabilityを保証しない | Harness-owned tools、Ledger / CAS、gVisor Lab | runsc、read-only source、ephemeral provider home、SQLite Receipt、no fallback |
| Main risk | positive oracleへ過適合 | AIの判断をcodeで固め、LOCと内部stateが増える | agent varianceとblind spotが見えにくい。実Target evaluationが必須 |

**Inference:** 現行方式は「Promptだけ」に戻したのではない。研究判断はPrompt / native agentへ戻すが、Promptだけでは保証できないauthority、source integrity、failure、freshness、resume、external human gateをHarnessに残している。

## What wp2shell actually did

| Concern | Observed |
| --- | --- |
| Input layout | latest stable WordPressを`main/`へ置き、`.git`を削除し、必要なPHP / MySQL等を取得する空の`third_party/`を併設した。[Exact setup](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell) |
| Prompt | vulnerabilityの存在、typical MySQL deployment、pre-authからRCE、`/flag`読取というgoalを先に与えた。最大4 agent、最低6時間、approach-family registry、divergent route、blocked route、adversarial check、rootによるsynthesis / redirect / next roundも指定した。 |
| Agent loop | 最初の長時間runがpre-auth SQLiを出した後、人間がstock WordPressでadmin email読取を試させた。その後、人間がRCEへ昇格できるかを追加で質問し、約4時間後にchainが完成した。最初のpromptだけで最後まで無人だったわけではない。 |
| Validation | 人間がremoteのstock installでSQLi effectを確認し、翌日にchainを解読してreportを準備した。公開された約10時間 / 約USD 25は一成功例で、複数target、negative control、miss、run varianceはない。 |

**Inference:** 直接再利用できるのはraw source、history禁止、dependency source、最大4 native subagentという同時実行上限、rootによる反復統合、途中primitiveを次の具体的gapへつなぐ考え方である。4体の固定起動や固定roleにはせず、Rootが上限内で実数と再投入を決める。positive oracle、`/flag`、6時間の固定下限、typed approach registryをHarness stateへ移すと、prospective recallを測れず、RCE以外の重大Findingを歪める。

## Public agentic harnesses

| Reference | Search and iteration | Validation / coverage | Reusable lesson |
| --- | --- | --- | --- |
| Anthropic reference harness | optional Reconがfocus areaを作り、parallel Finderがslice内を探索する。[Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L40-L68) | fresh containerでPoCをgradeし、複数runのvarianceをunionする。[Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L114-L147) | Harnessがpartitionとruntime oracle、agentがslice内のpathを所有する。semantic WordPress reviewへそのまま移植しない。 |
| Codex Security | parentがbaselineとsource-backed investigation packetを作り、workerはpacket外のpromising evidenceも追う。[Core scan](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/core-scan.md#L7-L39) | unique findingごとにfresh local-source Validation。coverageはauthorized inventoryとの対応を残す。 | packetは開始点でありscopeではない。FindingとCoverageを別々にsealする。 |
| Mandiant AVDH | Explorer / Specialist、entry-point enrichment、Access Control / Data Flow agentsへrouteする。[Architecture](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#architecting-the-pipeline) | 複数Validation agentとSynthesis後、人間がdynamic PoCを確認する。[Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation) | file / entry-point coverageとsemantic validityは別。記事の固定pipelineをInterface根拠にしない。 |
| Cloudflare VDH / VVS | area × attack-class cell、micro-fork、Gapfill、producer-consumer loop。[Stages](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#codifying-the-skill-into-a-pipeline) | original code上のPoCと別model review。[Validation](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust) | explicit gapとfresh validationは有用。cell taxonomyを未知semantic bugのclosureにしない。 |
| Wordfence PRISM / Argus | PRISMはWordPress specialist agentsで広い短いpath、Argusは一targetの長いmulti-step chainを追う。両者ともdangerous operationから逆向き、untrusted inputから順向きにtraceする。[Breadth / depth](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/#breadth-and-depth) | PRISMはPoC実行を掲げ、ArgusのAvada 6-step chainはisolated targetで人間がend-to-end確認した。 | short-hop / long-chainを別の評価層として持つ価値を示す成功例。二つのproduction engineを作る根拠やrecall比較ではない。 |
| Unit 42 NOVA | scoping後にparallel discoveryがranked candidateを作り、failed validationを次waveへ戻す。reviewed / ruled-out / proof-pending pathを記録する。[Harness](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/#how-the-autonomous-research-harness-works) | PoC、clean environmentでのdeterministic replay、adversarial gateを使う。14 projectsでは各modelが他modelにないFindingを多数追加した。 | 複数modelのunionが発見集合を広げる証拠。ただしknown-CVE recallではなく、fixed role、ranking、runtime、patch / protection生成は現行診断coreの根拠にならない。 |

## Known-CVE recall evidence

**Observed:** Aikidoはrecent CVE 32件を10 modelへ各3回、fresh session、最大30 turns、internetなしで実行し、case、prompt、tools、evaluation policyを固定した。[2026-08-21 benchmark](https://www.aikido.dev/blog/ai-model-benchmarks-aug-21-2026)。DeepSeek V4 Proは一回目17 / 32から3-run union 28 / 32へ増えた。Grok 4.6はunion 26 / 32、3回すべてで見つけたconsistent resultが21 / 32、GLM 5.3はunion 25 / 32、consistent resultが18 / 32だった。反面、DeepSeek Proのreported candidate中false leadは34.4%、Solは3.3%で、union recallと後段負荷にtrade-offがあった。

**Limit:** これはmodel比較であり、Mandiant、Cloudflare、Wordfence、NOVA、Anthropic Harness、Codex Securityの比較ではない。8月版はtarget、revision、prompt、tool、candidate判定を公開せず、既知箇所をagentへ与えたかも不明である。公開dataset、patched negative、secure repoがないため、full-repository navigation、prospective recall、false-positive率は再現できない。

**Inference:** 現行Harnessに直接使える最も強い結果は、単一runをrecall baselineにせず、同一の凍結条件でfresh runを反復し、single-run、union、再現率、Validation rejectionを別々に測ることである。長いturn数、aggressive candidate、model ensembleのどれが因果的に効いたかは示されていない。

## Comparison-guided priorities

| Priority | Concrete next behavior | Why / boundary |
| --- | --- | --- |
| P0 | oracleをagentから隔離したWordPress boundary corpusで、同じTarget / Prompt / Runtime / Permissionを当面3 fresh Campaignずつ実行し、single-run recovery、3-run union、3 / 3 consistency、Validation rejection / pending、patched negativeを記録する。 | Aikidoが直接示したrecall改善はfresh-run union。3は初期比較条件であってproduction Campaignの固定round数ではない。 |
| P0 | source-validated Finding後、外部提出候補へ上げる直前にofficial latest releaseをfresh取得し、同じcausal issueが残るかを別のlatest-source checkで確認する。残存時だけsubmission candidateとし、消失時も元Findingを削除せず`not-present-in-latest`観測をappendする。 | ユーザーの提出条件に対応する。Cloudflare VVSもfresh production contextと[latest mainのsourceを再確認](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#contextual-judgment)してapplicabilityを判定する。WordPressではGit mainではなく、配布対象のofficial latest packageを正本にする。Discovery oracleへは戻さない。 |
| P0 | short-hop Findingを保持したまま、source-boundなchain gapが残れば同じRootが継続できることをknown-positiveで確認する。RCEへ伸びなくてもSQLi / Stored XSS等は独立成功とする。 | wp2shell / Argusは途中primitiveを長いchainへつなぐ価値を示す。現行`candidate + nextActions + continue`で表現でき、新しいDepth subsystemは不要。 |
| P1 | wp2shellのdiverse approach、stalled route、root synthesisというprompt要素だけを一変数ずつablationする。 | 成功例はあるが因果証拠がない。typed registry、固定agent数、固定roundへせず、P0 corpusのrecall差が出た要素だけ採用する。 |
| P1 | Grok / GLM等を同一Campaign内で混ぜず、同じ凍結caseの別Runtime Profile Campaignとして比較し、評価側だけでunionする。 | AikidoとNOVAはrun / model complementarityを示す。現行のno-silent-fallbackとFinding provenanceを保つ。 |
| P1 | source Findingとは別にfresh runtime reproductionをHuman OSへ接続し、提出判断のassuranceを増やす。 | wp2shell、Anthropic、Cloudflare、Wordfence、NOVAはruntime witnessを重視する。ただしResearch / Independent ValidationでTarget codeを実行せず、source Findingの成立条件にも戻さない。 |

### Do not import now

- positive RCE oracle、`/flag`、CVE / patch / history、4体の固定起動、6時間の固定下限を通常Promptへ入れない。最大4 native subagentという同時実行上限だけをPromptへ置く。
- PRISMの固定class specialist、AVDHのwaterfall / Confidence Filter、Cloudflareのarea × attack-class cell、NOVAのranking / gatekeeperをHarness-owned research decisionへしない。
- multi-agent voteや支持数でminority candidateを落とさない。Independent Validation一回とcandidateごとのcounterevidenceを維持する。
- cross-repo scheduler、fleet queue、Feedback prompt rewrite、patch生成、virtual protection、publication gateを診断coreへ入れない。
- runtime PoC、target build / test、project historyをsource-only Research / Independent Validationへ混ぜない。
- file、entry-point、cell coverageを`coverage-closed`の代用にしない。

## Current local implementation

| Concern | Current behavior | Evidence |
| --- | --- | --- |
| Search space | Agentはimmutable Target全体をreadでき、Promptはfile、CWE、手順を固定しない。 | [`gvisor-agent-sandbox.ts`](../../src/research/agent-led/gvisor-agent-sandbox.ts) |
| Iteration | Reportが具体的next action付き`continue`ならprivate Agent Checkpointからprovider session / scratchを再開し、`stop`ならpending candidateをValidation後に終了する。 | [`research-campaigns.ts`](../../src/research/agent-led/research-campaigns.ts) · [`research-campaigns.test.ts`](../../tests/research/research-campaigns.test.ts) |
| Native agents | Grok BuildとClaude Codeをprovider固有Adapterで実行し、Grok evaluationからClaudeへfallbackしない。 | [`grok-native-agent-runtime.ts`](../../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../../src/research/agent-led/claude-code-native-agent-runtime.ts) |
| Evidence shell | Target / source tree / Prompt / Runtime / Permission / Budgetをbindし、runsc、non-root、read-only source、credential-free private Checkpointを要求する。 | [`contracts.ts`](../../src/research/agent-led/contracts.ts) · [`gvisor-agent-sandbox.ts`](../../src/research/agent-led/gvisor-agent-sandbox.ts) |
| Validation | Researchとは別scratch / sessionでcandidateを一度再導出する。 | [`independent-validation.test.ts`](../../tests/research/independent-validation.test.ts) |
| Finding / Coverage | `source-validated`だけがFindingを作り、Coverageとfailureを別々に復元する。 | [`research-campaigns.test.ts`](../../tests/research/research-campaigns.test.ts) |

Claudeのexact imageでは、Root / native subagent双方についてprovider read、Target write、shell、Webの拒否とscratch writeを実測し、public Campaign smokeも完走した。さらに同じprivate Checkpointとsession IDを使う`continue -> resume -> stop`を実processで確認した。Grok Target Proposal Adapterもproduction seamへ接続し、Approved Target BatchからCampaignへのadmissionは`ApprovedTargetCampaigns.conduct`へ接続した。Human OSはFinding-bound Private Recipeのsingle replayとfresh runsc WordPress / MySQL labを持つ。現在の弱点は、Grokのcompleted capability / resume probeがprovider HTTP 402で未完了なこと、GLM Validationのformat補正再実行がsingle-fresh-run policyと未整合なこと、Research FindingからPrivate Recipeへの自動handoffが未接続なことである。構造が小さくなったこと自体は探索性能の証明ではない。
