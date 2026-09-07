---
status: accepted; provider-native subagent prohibition superseded by ADR 0125
supersedes: 0066
---

# Expose only harness-owned tools to model Attempts

全worker roleへ公開するtoolを、版付きrole manifestにあるharness所有toolだけに限定する。Target Snapshotのread・search・graph queryと、credential・network・host path・Target writeを持たない隔離scratch computeを提供し、provider組込みshell、filesystem tool、web、plugin、hook、ambient MCP、memory、subagentを無効化する。無効化またはprovider credentialからの分離を検証できないtransportはproduction不適格とする。

Discovery系roleにはsource toolだけを与え、Verifierと必要なSkepticだけにWork Leaseとmechanismへ拘束したtyped Experiment toolを追加する。実装protocolにstdio MCP等を利用できるが、unknown tool、schema・lease・path・budget違反をharnessが実行前に拒否し、provider固有tool mechanicsをCampaign Controlへ漏らさない。この制約はnative CLIの便利なBashを失う代わりに、untrusted sourceによるprompt injectionからprovider credentialとhost control planeを隔離し、role権限とtool evidenceを再現可能にする。
