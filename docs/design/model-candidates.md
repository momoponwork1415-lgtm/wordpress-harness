# Model candidates

Status: Candidate set, profile and effort unassigned

初期の評価候補は次の4系統とする。

- GLM 5.3
- Grok 4.6
- `gpt-daybreak-blue-latest`
- Opus 5

これらは設計時の論理名であり、実行時のprovider slug、endpoint、利用可能なeffort、tool capabilityは各adapterの接続時に確認する。候補であることはproduction採用を意味しない。

初期transportはsubscription credentialを所有するnative agent processとする。

| Candidate | Native agent process |
| --- | --- |
| GLM 5.3 | isolated Z.ai profileの`claude -p` |
| Grok 4.6 | `grok -p` |
| `gpt-daybreak-blue-latest` | `codex exec` |
| Opus 5 | `claude -p` |

subscription OAuthまたはCoding Plan keyを独自APIへ流用しない。API/service credentialを別途導入した場合だけ`DirectApiTransport`を追加する。詳細は[transport research](../research/model-transport-and-subscription-auth.md)と[ADR 0061](../adr/0061-use-native-agent-processes-for-subscription-models.md)に記録する。

初回評価では、4系統すべてをMapper、Finder、Verifier、Skepticの全roleで測る。事前にroleを固定せず、共通benchmarkの結果からroleごとの候補を絞る。

adapter実装順はmodel評価と分ける。最初のvertical sliceはClaude process adapterのOpus profile一つで完走させ、次に同adapterのGLM profile、Codex、Grokの順で接続する。これはbootstrap順であり、Opusを各roleの勝者とみなす判断ではない。詳細は[ADR 0069](../adr/0069-bootstrap-with-the-claude-process-adapter.md)に記録する。

評価は二段階にする。

1. role別benchmarkで各modelのcoverage、recall、precision、誤昇格阻止、費用、varianceを測る
2. roleごとのfinalistだけを組み合わせ、end-to-end Campaignでverified Finding、cost、time、varianceを測る

effortはprovider間で共通名称へ正規化しない。各model/roleについてprovider defaultと隣接する低・高設定をDevelopment Cohortで比較し、利用できないmodelでは固定値とする。比較には設定ラベルではなく実測cost、latency、品質を使う。

各Model Profileは同じCaseで最低3回実行する。per-run品質、variance、worst run、3回のunion yieldを別々に記録し、unionだけで採用を決めない。

未決定事項:

- benchmark後のroleごとの採用model
- benchmark後のmodel/role固有effort設定
- context windowとtool policy
- timeout、retry、token/cost ceiling
- provider CLI version、credential expiry、policy gate
- benchmark cohortと昇格threshold
