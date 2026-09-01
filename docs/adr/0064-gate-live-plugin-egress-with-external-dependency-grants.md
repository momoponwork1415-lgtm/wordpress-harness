---
status: accepted
supersedes: 0026
---

# Gate live plugin egress with External Dependency Grants

SetupとResearchでnetwork policyを分け、Agent SandboxからはModel Profileが要求するprovider通信以外のegressを禁止する。WordPress Verification Labはdefault-denyとするが、pluginの通常機能またはHypothesisがFacebook等の外部serviceを必要とする場合、Campaign開始前にhash固定した`External Dependency Grant`で最小限のlive egressを許可できる。

Grantは少なくともservice identity、許可hostname/port/protocol、必要なconfiguration variant、用途、test account、credential policy、request/response記録とredaction、rate ceiling、有効期間、失敗時の扱いを持つ。接続はpolicy-enforcing proxyを経由し、DNSまたはredirectだけで許可範囲を拡張しない。未宣言host、汎用web access、Research中のdependency downloadは拒否する。

優先順位は次の通りとする。

1. semanticに十分なlocal emulatorまたはsynthetic fixture
2. 人間が取得しhash固定したsanitized responseのrecord/replay
3. live External Dependency Grant

live dependencyを使ったExperimentは`non-hermetic`と記録し、service response、account state、時刻、rate limitによる不確実性をCausal ControlとFindingへ明示する。live failureをpluginの`Disproved`へ変換せず、dependency reason付き`Blocked`とする。
