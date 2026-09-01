---
status: accepted
---

# Require gVisor for production evidence

Linux上の初期production isolation backendはgVisorのOCI runtimeである`runsc`に固定する。Agent SandboxとWordPress Verification Labを通常の`runc`ではなく`runsc`で起動し、Campaign開始前のcapability probeでruntime identity、filesystem、network policy、WordPress/PHP/MySQL、browser、Experiment brokerの動作を確認する。

gVisorまたは必須capabilityが利用不能な時、host executionまたはplain Dockerへsilent fallbackしない。Campaignを開始前に拒否するか、infrastructure reason付きでpauseする。

plain Dockerは、既知のsynthetic fixtureを使うharness開発とcontract/integration debuggingに限り、明示的なunsafe development modeで利用できる。その実行には`non-evidentiary`を記録し、Finding、Human Confirmation、Development Cohort合格、Sealed Evaluation結果へ昇格させない。

gVisorを使用しても、privileged container、host network、container engine socket、credential-bearing host path、unrestricted egressを許可しない。より強いKata ContainerまたはmicroVM backendは、互換性またはthreat model上の実需要が確認された時に追加する。
