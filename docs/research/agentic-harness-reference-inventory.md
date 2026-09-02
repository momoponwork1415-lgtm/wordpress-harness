# Agentic harness reference inventory

Status: supporting research note, 2026-09-02

## Purpose and counting rule

この文書は、agentic vulnerability research harnessの参照資料を「公開リファレンス実装」「設計・運用リファレンス」「実績・評価リファレンス」に分け、URLの重複で件数を水増ししないための棚卸しである。

件数はrepositoryまたはfirst-party articleを一つの`Reference Entity`として数える。tracking parameter、repository内のREADME・Best Practices・固定commitへのlinkは同じentityへ正規化する。一つのentityが複数categoryを満たす場合も、重複排除した合計では一件とする。単に候補として列挙されたrepositoryは数えず、[Design references](../REFERENCES.md)または[Harness source-mapping patterns](harness-source-mapping-patterns.md)の固定revision一覧へ明示的に採用・調査されたものを現在のinventoryとする。

この分類は[Design references](../REFERENCES.md)の3件を追加・置換しない。外部実装や評価記事は、個別mechanismの比較と実績の解釈に使うsupporting referenceである。

## Current inventory

### Canonical design and operation references

[Design references](../REFERENCES.md)には次の3 entityが記録されている。

1. [Google Cloud / Mandiant — Staying Ahead of Adversarial AI Through Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
2. [Anthropic — Defending Code Reference Harness](https://github.com/anthropics/defending-code-reference-harness)
3. [Wordfence — Wordfence Argus: Moving Beyond Human Research Capability](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)

### Inspected public reference implementations

[Harness source-mapping patterns](harness-source-mapping-patterns.md)の固定revision一覧には、実装を検査した次の8 public repositoryが記録されている。

1. [Anthropic `defending-code-reference-harness`](https://github.com/anthropics/defending-code-reference-harness)
2. [Knostic `OpenAnt`](https://github.com/knostic/OpenAnt)
3. [OpenAI `codex-security`](https://github.com/openai/codex-security)
4. [Protect AI `vulnhuntr`](https://github.com/protectai/vulnhuntr)
5. [IRIS](https://github.com/iris-sast/iris)
6. [Visa `visa-vulnerability-agentic-harness`](https://github.com/visa/visa-vulnerability-agentic-harness)
7. [Capital One `VulnHunter`](https://github.com/capitalone/VulnHunter)
8. [Semgrep `defending-code-harness`](https://github.com/semgrep/defending-code-harness)

Anthropic entityは両一覧に現れるため、現在の明示的inventoryは`3 + 8 - 1 = 10` unique entitiesである。現在の公開リファレンス実装数は8件である。

## Classification of the proposed sources

| Proposed source | Primary classification | Secondary value | Public implementation | Existing entity | Basis |
| --- | --- | --- | --- | --- | --- |
| [OpenAI Codex Security](https://github.com/openai/codex-security) | 公開リファレンス実装 | 設計・運用リファレンス | Yes | Yes | OpenAIのpublic repositoryは、脆弱性の発見・検証・修正を行うCLIとTypeScript SDK、複数workerを使うdeep run、durable workflowを公開している。既に固定revisionを調査済みである。 |
| [Semgrep Defending Code Harness](https://github.com/semgrep/defending-code-harness) | 公開リファレンス実装 | 設計・運用リファレンス | Yes | Yes | Semgrepのpublic repositoryは、自らをreference pipelineと位置付け、`recon -> find -> verify -> report -> patch`、gVisor sandbox、parallel runを実装している。既に固定revisionを調査済みである。 |
| [Unit 42 — The Frontier AI Vulnerability Burst](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/) | 実績・評価リファレンス | 設計・運用リファレンス | No | No | Unit 42はNOVAをproprietary AI harnessと明記する一方、scoping、parallel Discovery、PoC、clean environmentでのdeterministic validation、isolated replay、Gatekeeperという高水準flowと運用結果を公開している。 |

OpenAI Codex Securityは、公開READMEでCLIとTypeScript SDKの実体、deep modeのworker・反復設定、containerized bulk scanとdurable workflowを確認できる。[OpenAI Codex Security README](https://github.com/openai/codex-security#readme) このrepositoryは既に[development-harness reference](codex-security-development-harness-reference.md)と[Harness source-mapping patterns](harness-source-mapping-patterns.md)で調査済みなので、新規entityではない。

Semgrep harnessは、公開READMEでAnthropic版から派生したmaintained repositoryであること、自律pipelineがC/C++・ASAN向けのreferenceであって製品ではないこと、agentをgVisorとegress allowlistで隔離することを明記する。[Semgrep Defending Code Harness README](https://github.com/semgrep/defending-code-harness#readme) これも既に[Harness source-mapping patterns](harness-source-mapping-patterns.md)で調査済みなので、新規entityではない。

Unit 42の記事は、NOVAが公開実装ではなくproprietary harnessであると明記する。そのため実装を移植・検査するreferenceではない。一方、記事はhuman-in-the-loopをfinal reviewまで置かないflow、working PoC、clean environmentでのdeterministic validation、parallel Discovery、isolated replay、Gatekeeper、複数containment layerを説明しており、設計・運用比較には使える。[Unit 42, NOVA overview and results](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/#nova-fully-automated-novel-vulnerability-discovery-and-validation) [Unit 42, harness architecture](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/#nova-research-harness-architecture)

同記事は、2か月で3,915 OSS projectsを分析し、14,090 confirmed vulnerabilitiesを得たと報告する。この数値はUnit 42によるfirst-party reportであり、公開datasetによる独立再現結果とは扱わない。[Unit 42, executive summary](https://unit42.paloaltonetworks.com/frontier-ai-vulnerability-burst/)

## Deduplicated result

| Count | Before | After adding the three proposed URLs | Net change |
| --- | ---: | ---: | ---: |
| Public reference implementations | 8 | 8 | 0 |
| Canonical design references | 3 | 3 | 0 |
| Unique entities across the explicit inventory | 10 | 11 | +1 |

結論として、提示された3 URLのうちCodex SecurityとSemgrep harnessは既存8実装に含まれている。Unit 42は新規entityだが公開実装ではない。したがって、**リファレンス実装は8件のまま**で、記事を含む明示的な参照inventory全体は**10件から11件**になる。
