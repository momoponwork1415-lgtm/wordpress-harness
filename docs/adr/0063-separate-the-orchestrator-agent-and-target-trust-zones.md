---
status: accepted
---

# Separate the control plane, agent, and target trust zones

runtimeを三つのtrust zoneへ分離する。

```text
Trusted Control Plane
  ├─ per-Attempt Agent Sandbox
  └─ disposable WordPress Verification Lab
```

trusted control planeはResearch Record、private artifact参照、credential sourceとsandbox lifecycleを所有し、target codeまたはmodel-selected commandを直接実行しない。Agent Sandboxはprovider-native Rootとsubagentを実行し、Target / Dependency Snapshotをread-only、isolated scratchだけをwritableにする。Verification LabはWordPress、PHP、database、browserとplugin codeを実行するfreshな使い捨て環境とする。

Agent SandboxとVerification LabはgVisor相当以上のisolation backendを要求し、利用不能時にhost processまたはplain Dockerへfallbackしない。Agentへhost filesystem、Research Record write access、credential-bearing pathまたはcontainer engine socketを渡さない。Research側はtargetを実行せず、target runtimeへの操作はHuman OSのVerification Labだけが所有する。

Agent SandboxとVerification Labのnetwork capabilityは別々に定義する。Agent側はprovider通信だけを許可し、Lab側のplugin外部依存は別のpolicy decisionとしてCampaignへ明示する。
