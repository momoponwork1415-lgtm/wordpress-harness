---
status: accepted
---

# Broker live-service credentials

External Dependency Grantで使用するcredentialは、Campaign artifactまたはAgent Sandboxへ値として保存せず、trusted control planeの`Credential Broker`がopaqueな`SecretRef`として管理する。credentialには専用の非production test account、最小scope、短い有効期間、rate ceiling、owner、rotation/revocation手順を要求し、個人用またはproduction accountを既定で拒否する。

可能なserviceではpolicy-enforcing proxyがrequest送信直前にcredentialを注入し、Agent SandboxとWordPress Labのfilesystem、environment、transcriptから値を隠す。pluginの正常なOAuth/token storage挙動そのものが検証対象で、plugin processがcredentialを読む必要がある場合だけ、Grantへ`target-visible`を明示し、just-in-timeでLabへ渡す。

`target-visible` secretはCampaign専用、最小scope、期限付きとし、Lab破棄時に失効または確実に削除する。Agentはsecret値、raw WordPress option、credential-bearing requestを直接読めず、typed Experiment Brokerからredacted observationだけを受け取る。

Research LedgerとCASにはSecretRef、credential kind、scope digest、有効期間、注入receipt、redaction status、revocation receiptだけを記録する。raw token、cookie、authorization header、refresh tokenは保存しない。redactionが証明できないartifactはFinding evidenceまたはbenchmark fixtureへ昇格させない。
