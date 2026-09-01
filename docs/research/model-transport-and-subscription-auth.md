# Model transport and subscription authentication

Status: implementation research, 2026-09-01

この文書はModel Executionの実装方式を選ぶための調査記録である。設計の正本は[三つのDesign references](../REFERENCES.md)のままとし、ここに挙げるprovider文書はtransport、authentication、利用条件を確認するimplementation evidenceとして扱う。

## Conclusion

consumer subscriptionのOAuth tokenまたはCoding Plan keyを、独自の共通model APIへ取り出して流用しない。初期候補はprovider公式のagent CLIをfresh processとして起動する`NativeAgentProcessTransport`だが、公式用途、version固定、credential isolation、built-in tool無効化、structured output、process terminationのprobeを全て通過したtransportだけをproductionへ採用する。API/service credentialを明示的に導入した場合だけ`DirectApiTransport`を追加する。

```text
CampaignRunner
  -> Model Execution supervisor
       -> NativeAgentProcessTransport
            -> eligible official Claude client
            -> eligible official Codex client
            -> eligible official Grok client
            -> eligible official GLM-supported client
       -> DirectApiTransport   (future, API/service credentials only)
```

CLIは一つのWork Lease内のagent loopとprovider protocolを所有する。harnessはWork Lease、Prompt Set、role別tool manifest、process/container、wall ceiling、retry ceiling、usage normalization、transcript durability、Campaign transitionを所有する。provider組込みtoolは無効化し、CLIはResearch Ledgerを読まず、workerを割り当てず、modelまたはeffortを選ばない。

Remote ControlはCampaignRunner/Readerを遠隔操作するoperator surfaceであり、provider session、worker transportまたはscheduler protocolにはしない。

## Anthropic reference harness

Anthropicのautonomous reference pipelineはSDK/API直結ではなく、trusted Python orchestratorが隔離container内で`claude -p --output-format stream-json`をsubprocess起動する構造である。

- phase、並列度、retry、container lifecycle、artifact、transcriptは外側のharnessが所有する。
- agent loop、session、Read/Write/Bashなどのbuilt-in toolsはClaude Code CLIが所有する。
- agent processはtargetと同じgVisor containerへ置き、host orchestratorはtarget codeまたはmodel-selected commandを実行しない。
- setupとattackでnetwork policyを分け、attack時のegressをmodel endpointへ限定する。
- transient errorではCLI sessionを外側の上限内でresumeし、stage resultはdurableに保存する。

このreference harnessがClaude CodeのRead/Write/Bashを利用することは実装事実として参考にするが、本projectではuntrusted sourceからprovider credentialとhost control planeを隔離するため、そのtool設計を採用しない。provider組込みtoolを無効化し、harness所有の制限付きtoolへ置き換える判断は[ADR 0105](../adr/0105-expose-only-harness-owned-attempt-tools.md)に記録する。

Primary evidence:

- [Reference pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/pipeline.md)
- [Agent sandbox](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/agent-sandbox.md)
- [Best practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
- [Headless CLI wrapper](https://raw.githubusercontent.com/anthropics/defending-code-reference-harness/main/harness/agent.py)

## Provider matrix

| Profile family | Subscription-supported native path | Initial adapter | Important constraint |
| --- | --- | --- | --- |
| Claude / Opus | Claude Code OAuth or setup token with `claude -p` | Claude process adapter | use supported CLI auth; do not expose OAuth as a generic API credential |
| GPT / Codex | ChatGPT sign-in with `codex exec --json` | Codex process adapter | pin CLI/profile; auth lifetime and quota failure remain observable operational dependencies |
| Grok | Grok Build OAuth with headless `grok -p` or ACP | Grok process adapter initially | disable auto-update and subagents; security-research policy requires explicit review |
| GLM | GLM Coding Plan key in a listed supported coding tool | Claude process adapter with a separate GLM profile | direct custom application/API use of subscription benefits is not assumed permitted |

### Claude

Claude Code documents non-interactive `-p` for scripting and supports structured streaming output. Anthropic's own reference harness accepts direct API credentials, cloud providers, or Claude Code OAuth while retaining the same CLI-process boundary.

- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Programmatic use](https://code.claude.com/docs/en/headless)
- [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

### GPT / Codex

Codex is included in eligible ChatGPT plans and the local CLI is an official client. The installed CLI provides non-interactive `codex exec`, JSONL output, explicit model and sandbox settings, device authentication, strict config, and ephemeral sessions. The subscription credential remains owned by Codex; the harness consumes the supported CLI surface rather than extracting its token.

- [Using Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-codex-and-chatgpt-plan-usage-limits)
- [Codex CLI sign-in](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt)

### Grok

Grok Build documents headless use for scripts, bots, and integrations, structured streaming output, device/OAuth login, tool restriction, turn limits, session control, and ACP. The initial adapter uses the simpler headless process protocol; ACP can replace it if process-stream normalization becomes the measured maintenance hotspot.

- [Grok Build overview](https://docs.x.ai/build/overview)
- [Headless and scripting](https://docs.x.ai/build/cli/headless-scripting)
- [CLI reference](https://docs.x.ai/build/cli/reference)
- [Acceptable use policy](https://x.ai/legal/acceptable-use-policy)

### GLM

GLM Coding Plan is a subscription with a dedicated key and endpoint rather than a common OAuth transport. Z.ai restricts subscription benefits to supported tools and documents Claude Code configuration. Therefore the initial GLM profile runs through an unmodified supported CLI configuration; a custom direct API adapter requires PAYG/service credentials or explicit written permission.

- [Coding Plan quick start](https://docs.z.ai/devpack/quick-start)
- [Supported tools and endpoints](https://docs.z.ai/devpack/tool/others)
- [Subscription terms](https://docs.z.ai/legal-agreement/subscription-terms)
- [Usage policy](https://docs.z.ai/devpack/usage-policy)

## Required process-adapter controls

Each provider adapter must pass a common contract test while retaining provider-specific facts.

- executable path, version, profile, model, effort, prompt digest, and effective config are recorded before launch
- user/global instructions、built-in shell/filesystem、plugins、hooks、MCP servers、memory、web search、auto-update、subagentsを無効化する
- source read/search、graph query、隔離scratch compute、typed Experimentはharness所有のrole別tool manifestからだけ提供する
- source is read-only; only Attempt scratch is writable; credentials are not mounted into a model-readable path
- stdout event stream, stderr, final output, usage, exit reason, session reference, and termination escalation are captured as private artifacts
- outer supervisor enforces wall, process, turn/tool, concurrency, and retry ceilings even when the CLI has its own limits
- unknown event types, missing usage, silent effort fallback, model substitution, or executable drift prevent a successful Attempt outcome
- live capability probes are separate from deterministic contract fixtures

## Open questions and policy gates

- consumer subscriptionのavailability、再認証、quota exhaustionはTransport Eligibilityと運用probeで継続観測し、`auth-required`またはprovider failureを可視化する
- intended volumeまたはautomated defensive researchの許可を公式資料で確認できないproviderは、有効化前に書面確認するか候補から保留する
- built-in tool無効化とtool subprocessからのcredential isolationを実証できないproviderは候補から保留する
- CLI session resumeは同じAttemptのbounded continuationとしてだけ校正し、fresh independent runに数えない
