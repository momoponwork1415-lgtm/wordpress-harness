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

## Public agentic harnesses

| Reference | Search and iteration | Validation / coverage | Reusable lesson |
| --- | --- | --- | --- |
| Anthropic reference harness | optional Reconがfocus areaを作り、parallel Finderがslice内を探索する。[Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L40-L68) | fresh containerでPoCをgradeし、複数runのvarianceをunionする。[Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L114-L147) | Harnessがpartitionとruntime oracle、agentがslice内のpathを所有する。semantic WordPress reviewへそのまま移植しない。 |
| Codex Security | parentがbaselineとsource-backed investigation packetを作り、workerはpacket外のpromising evidenceも追う。[Core scan](https://github.com/openai/codex-security/blob/c8296885fbbf593edc1b405dc49859496b2bd8e4/plugins/codex-security/references/core-scan.md#L7-L39) | unique findingごとにfresh local-source Validation。coverageはauthorized inventoryとの対応を残す。 | packetは開始点でありscopeではない。FindingとCoverageを別々にsealする。 |
| Mandiant AVDH | Explorer / Specialist、entry-point enrichment、Access Control / Data Flow agentsへrouteする。[Architecture](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#architecting-the-pipeline) | 複数Validation agentとSynthesis後、人間がdynamic PoCを確認する。[Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation) | file / entry-point coverageとsemantic validityは別。記事の固定pipelineをInterface根拠にしない。 |
| Cloudflare VDH / VVS | area × attack-class cell、micro-fork、Gapfill、producer-consumer loop。[Stages](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#codifying-the-skill-into-a-pipeline) | original code上のPoCと別model review。[Validation](https://blog.cloudflare.com/build-your-own-vulnerability-harness/#making-findings-you-can-trust) | explicit gapとfresh validationは有用。cell taxonomyを未知semantic bugのclosureにしない。 |

## Current local implementation

| Concern | Current behavior | Evidence |
| --- | --- | --- |
| Search space | Agentはimmutable Target全体をreadでき、Promptはfile、CWE、手順を固定しない。 | [`gvisor-agent-sandbox.ts`](../../src/research/agent-led/gvisor-agent-sandbox.ts) |
| Iteration | Reportが具体的next action付き`continue`なら新run、`stop`ならpending candidateをValidation後に終了する。 | [`research-campaigns.ts`](../../src/research/agent-led/research-campaigns.ts) · [`research-campaigns.test.ts`](../../tests/research/research-campaigns.test.ts) |
| Native agents | Grok BuildとClaude Codeをprovider固有Adapterで実行し、Grok evaluationからClaudeへfallbackしない。 | [`grok-native-agent-runtime.ts`](../../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../../src/research/agent-led/claude-code-native-agent-runtime.ts) |
| Evidence shell | Target / source tree / Prompt / Runtime / Permission / Budgetをbindし、runsc、non-root、read-only source、ephemeral scratchを要求する。 | [`contracts.ts`](../../src/research/agent-led/contracts.ts) · [`gvisor-agent-sandbox.ts`](../../src/research/agent-led/gvisor-agent-sandbox.ts) |
| Validation | Researchとは別scratch / sessionでcandidateを一度再導出する。 | [`independent-validation.test.ts`](../../tests/research/independent-validation.test.ts) |
| Finding / Coverage | `source-validated`だけがFindingを作り、Coverageとfailureを別々に復元する。 | [`research-campaigns.test.ts`](../../tests/research/research-campaigns.test.ts) |

現在の弱点は、real providerのforbidden-capability probe、Target Proposalのproduction Adapter、Approved BatchからCampaignへのdispatch、Human OSのactual runtime provisioner、Brizy vulnerable / patched / bare controlの境界試験が未完了なことである。構造が小さくなったこと自体は探索性能の証明ではない。
