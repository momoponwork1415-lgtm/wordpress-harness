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

## Claude native Source Evidence bridge (2026-09-02)

この節は、acceptedな`SourceEvidenceGateway.query`をClaude Code 2.1.258のheadless Finderへ公開するためのimplementation researchである。Claude Codeの仕様が直接保証する事実、本harnessへのadaptation、未確認点を分ける。

### Providerが保証する事実

| Claim | Primary evidence | Consequence |
| --- | --- | --- |
| `claude -p`は`--mcp-config`を読み、`--strict-mcp-config`はそれ以外のMCP configurationを無視する | [CLI reference](https://code.claude.com/docs/en/cli-usage) | Attemptごとにharnessが生成した明示configだけを入力にできる。 |
| HTTP MCP entryは`{"type":"http","url":"..."}`を使い、`streamable-http`もaliasとして受理される。HTTP entryはstatic `headers`を持てる | [Claude Code MCP reference](https://code.claude.com/docs/en/mcp) | 先に起動したlocal serverと、Attempt-local capability headerをexplicit configで渡せる。 |
| `--restricted`はcommand/code execution系built-in toolとWebFetchを外し、user/project/local settingsを読まず、managed settingsと`--settings`だけを残す | [CLI reference](https://code.claude.com/docs/en/cli-usage) | 共有machineのambient customizationを減らす主制御として使える。 |
| `--tools ""`は全built-in toolを無効化するがMCP toolには影響しない | [CLI reference](https://code.claude.com/docs/en/cli-usage) | built-in filesystem/shell/webなしでharness-owned MCP toolだけを残せる。 |
| MCP toolのcanonical nameは`mcp__<server-name>__<tool-name>`で、`allowedTools`はそのtoolをpromptなしで許可する | [Agent SDK MCP reference](https://code.claude.com/docs/en/agent-sdk/mcp), [permission rules](https://code.claude.com/docs/en/permissions#mcp) | server wildcardではなく`mcp__source_evidence__source_search`と`mcp__source_evidence__source_read`を個別許可できる。 |
| `dontAsk`はpre-approvedでないtoolを自動拒否する。`anthropic/requiresUserInteraction`が付いたMCP toolは`allowedTools`でも非対話実行では許可できない | [Permissions](https://code.claude.com/docs/en/permissions), [MCP explicit approval](https://code.claude.com/docs/en/mcp#require-approval-for-a-specific-tool) | `--permission-mode dontAsk`とexact allowlistを併用し、read/search toolへ`requiresUserInteraction`を付けない。 |
| MCP tool searchはdefaultで有効で、serverの`alwaysLoad: true`はtool schemaをfirst turnから必ずcontextへ載せる | [MCP tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) | built-in toolを全て外した時にdiscovery toolへ依存しないよう、小さなSource Evidence serverを`alwaysLoad`にする。 |
| `--mcp-config`の不正entryはskipされても`-p`が成功終了し得る。`stream-json`の`system/init` eventは`mcp_servers`/`mcp_server_errors`を持つ | [Programmatic use: detect MCP load failure](https://code.claude.com/docs/en/headless#fail-ci-when-a-plugin-or-mcp-server-doesnt-load) | final JSONだけでbridge readinessを推測しない。init eventのserver name/status/errorをdecodeしてfail closedにする。 |
| `--safe-mode`はMCP serverを含む全customizationを無効化する。一方、公式文書はexplicit `--mcp-config`をsafe modeの例外とは明記していない | [CLI reference](https://code.claude.com/docs/en/cli-usage) | native bridgeでは`--safe-mode`を使わず、`restricted + strict-mcp-config + tools empty + disable-slash-commands`で必要な分離を構成する。 |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`はBash、hook、stdio MCP childからAnthropic/cloud/recognized credential environmentを除去し、Claude parentのAPI認証は保つ | [Environment variables](https://code.claude.com/docs/en/env-vars#variables) | stdioのenvironment leakageに対するdefense-in-depthになるが、credential fileとHOMEまで隔離する保証ではない。 |
| `/login`のsubscription OAuthはPro/Max/Team/Enterpriseのdefaultで、environment API keyはそれより優先される。unmodified Claude Codeへ各end userが自分のsubscriptionでsign inすることは公式に許容される | [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence), [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) | harnessはcredentialを抽出・保存・中継せず、公式CLI processと`claude auth status`を使う。`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`の混入は別credentialへ切り替わるためprobe対象にする。 |
| `--bare`はOAuth credentialとkeychainを読まず、Anthropic API keyまたは`apiKeyHelper`を要求する | [Programmatic use: bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode) | subscription認証を維持するこのadapterでは使わない。 |

Installed `claude --help` 2.1.258も、`--restricted`、`--safe-mode`、`--strict-mcp-config`、`--tools`、`--allowedTools`について上と同じ説明を返した。これは実行machineのversion probeであり、web documentと別の設計参照ではない。

### Harnessへのadaptation

Claude Codeの一般向け文書はlocal integrationにstdio、remote serviceにStreamable HTTPを案内する。本harnessでは、stdio childがsubscription credential fileまで読めないことを公式文書からは保証できない。そのため、Claude processがspawnするtool subprocessを作らず、harness processがAttemptごとにloopback Streamable HTTP endpointを先に起動する方式を採用候補とする。これはprovider仕様の直接推奨ではなく、本projectのcredential isolation invariantへのadaptationである。

bridgeの最小構成は次の通り。

1. Harnessは`127.0.0.1`random portだけにbindし、`0.0.0.0`/`::`に公開しない。official MCP TypeScript SDKはlocalhost serverにHost/Origin validationを求め、自前HTTP wiringならそれを自分で実装するよう求める。[Official MCP TypeScript SDK server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md#dns-rebinding-protection)
2. Cryptographic randomなAttempt-local bearer capabilityをprivate temporary MCP configの`headers`に置き、argvへsecret値をinlineに置かない。serverはHost/Originに加えこのheaderをconstant-time検査する。このcapabilityはprovider credentialではなく、Attempt終了時にconfigとともに破棄する。
3. MCP serverは`source_search`/`source_read`の二toolだけを登録し、model入力からAttempt、Lease、Target Snapshot、Policy、query ordinalを受け取らない。これらはexisting `ModelExecution.run`のcallbackがharness側でbindする。
4. Configは`strict-mcp-config`、`alwaysLoad: true`、exact `allowedTools`、`dontAsk`を使う。tool responseはexisting bounded `SourceEvidenceReceipt`からmodelに必要なstatusとcontentだけを投影し、provider credential、host path、CAS internalsを含めない。
5. Native processはfinal structured outputとは独立に、Attempt-local bearerで認証されたMCP requestをserver側で観測できなければfail closedにする。これは現行のsingle-JSON envelopeを保ったまま、config skipを検出するlocal capability signalである。将来`stream-json`へ移す場合はinit eventのserver名、connected status、`mcp_server_errors`も同じgateへ取り込める。
6. completion、provider failure、timeout、cancellationの全pathでHTTP listener、進行中request、private configを`finally`でcloseする。Attemptごとに独立server/capabilityを使うため並列Finder同士も相互にqueryできない。

MCP protocolを独自に実装せず、official TypeScript SDKのStreamable HTTP serverとshutdown primitiveを使う。SDKはstateless handlerを使う場合にrequestごとのfresh server/transportを要求し、listenerとsession transportのclose手順を示している。[Official MCP TypeScript SDK server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

### Uncertainties and falsifiers

- `safe-mode + explicit --mcp-config`の優先順位は公式文書に明記されていない。safe modeの説明がMCP全体を無効にするため、bridgeは例外を仮定しない。将来、pinned CLIのsubprocess testでexplicit serverだけが読まれることとambient serverが読まれないことを両方実証できた場合のみ再検討する。
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`はcredentialと認識されるenvironment variableを除去するが、stdio MCP childのHOME、credential file、host filesystem、Linux `/proc`を一括隔離するとは書かれていない。したがってこの一設定だけでstdioをproduction-eligibleにしない。
- Claude Codeのmanaged settingsはcommand-line allowを上書きするdenyを持てる。exact MCP toolがorg policyでdenyされるmachineでは、native adapterはprovider failureへ丸めず`policy-denied`にする必要がある。[Permission settings precedence](https://code.claude.com/docs/en/permissions#settings-precedence)
- Claude Code 2.1.258とsubscription OAuthを使う合成live probeは、loopback random port、private bearer header、`alwaysLoad`、`dontAsk`、structured outputの組合せで通過した。fake providerのBehavior Testはexact tool inventoryと`search -> read`往復、bridge未接続時のfail-closedを再現する。production Campaign materializerのPolicy/query ceiling bindingも実装済みである。credential non-disclosureとlistener teardownを独立に観測するTransport Eligibility probe、および実Target Campaignのtool付き再走査はまだ必要である。

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
