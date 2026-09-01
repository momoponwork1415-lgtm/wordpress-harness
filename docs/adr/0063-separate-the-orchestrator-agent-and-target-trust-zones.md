---
status: accepted
---

# Separate the orchestrator, agent, and target trust zones

runtimeを三つのtrust zoneへ分離する。

```text
Trusted CampaignRunner
  ├─ per-Attempt Agent Sandbox
  └─ disposable WordPress Verification Lab
```

CampaignRunnerはResearch Ledger、CAS、credential source、container lifecycleを所有するtrusted control planeであり、target codeまたはmodel-selected commandを直接実行しない。Agent SandboxはNativeAgentProcessとそのtoolsを実行し、Target Snapshotをread-only、Attempt scratchだけをwritableにする。Verification LabはWordPress、PHP、database、browser、およびplugin codeを実行する使い捨て環境とする。

Agent SandboxとVerification LabはgVisor相当以上のisolation backendを要求し、利用不能時にplain host executionへfallbackしない。Agentへhost filesystem、Research Ledger write access、credential-bearing path、container engine socketを渡さない。Lab操作はversioned typed Experiment brokerを経由し、Agentが任意のcontainer lifecycleまたはhost commandを実行できないようにする。

Agent SandboxとVerification Labのnetwork capabilityは別々に定義する。Agent側はprovider通信だけを許可し、Lab側のplugin外部依存は別のpolicy decisionとしてCampaignへ明示する。
