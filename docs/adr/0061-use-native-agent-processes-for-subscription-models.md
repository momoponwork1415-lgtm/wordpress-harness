---
status: accepted
---

# Use native agent processes for subscription models

初期のModel Execution transportは`NativeAgentProcessTransport`とする。consumer subscriptionのOAuth tokenまたはCoding Plan keyを独自APIへ取り出さず、providerが公式に提供するagent CLIをheadless subprocessとして起動する。

| Model family | Initial native agent process |
| --- | --- |
| Claude / Opus | `claude -p` |
| GPT / Codex | `codex exec` |
| Grok | `grok -p` |
| GLM | Z.ai用の分離profileを適用した`claude -p` |

CLI processは一つのWork Lease内のagent loop、context、built-in tool mechanicsを所有する。外側のModel Execution supervisorはPrompt Set、tool policy、immutable workspace、process/container、wall/turn/retry ceiling、transcript durability、usage normalization、Campaign transitionを所有する。provider CLIはResearch Ledgerを直接読まず、別Work Leaseを作らず、modelまたはeffortを選択しない。

各adapterはexecutable、version、effective config、model、effort、prompt digest、credential kindをlaunch前に記録し、structured event streamとstderrをprivate artifactとして保存する。auto-update、ambient user settings、plugins、MCP、memory、web search、subagentは、version固定したModel Profileが明示的に許可しない限り無効にする。

`DirectApiTransport`は別の実在するseamとして、API課金またはservice identityを導入したproviderにだけ追加する。subscription OAuthをDirectApiTransportへ渡さず、transport kindをCampaign開始時に固定し、失敗時に別transportへsilent fallbackしない。

Remote Controlは人間が実行環境へ遠隔接続するoperator surfaceであり、Work Lease transport、scheduler、Campaign resumeには使用しない。Grokの防御的security researchと、GLM Coding Planを外部supervisorから反復起動する利用は、provider policyの確認をproduction profile有効化条件とする。
