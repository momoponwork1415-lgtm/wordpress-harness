---
status: accepted
---

# Keep Model Execution policy outside provider adapters

Model Execution moduleが、render済みPrompt Set、許可tool、Attempt ceiling、timeout、retry policy、usage/cost accounting、raw artifact captureを所有する。workerまたはprovider adapterはmodel、effort、retry、別worker、Campaign stateを選択できない。

provider adapterはversion固定したModel Profileと正規化Invocationを受け、provider固有のargvまたはwire formatへ変換し、正規化Outcomeとraw artifact参照を返す。adapterはCLI process、公式の低水準SDK、直接HTTPのいずれでも実装できるが、その選択をCampaign coreへ漏らさない。

CLIが一つのAttempt内でtool loopを機械的に実行する場合も、Model Execution moduleのprivate implementationとして外側からsuperviseする。CLIの暗黙session、retry、subagent、permission、default effortをCampaign policyの代用にしない。cross-Attempt orchestrationまたはResearch Ledgerの状態遷移をprovider側のAgent SDKへ委譲しない。

旧whitebox-harnessのprovider CLI launcherは移植しない。そこに記録されたprofile validation、credential isolation、structured output capture、process-group termination、provider差異は、新しいtyped adapterのcontract testとcapability probeへ変換する。
