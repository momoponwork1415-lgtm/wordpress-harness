---
status: accepted
---

# Require gVisor for production evidence

Linux上の初期production isolation backendはgVisorのOCI runtimeである`runsc`に固定する。Agent SandboxとWordPress Verification Labを通常の`runc`ではなく`runsc`で起動する。deployment capability probeでruntime identity、filesystem、network policy、WordPress/PHP/MySQL、browser、Experiment brokerの基本動作を確認し、各Campaignのsetupでもdigest固定したRuntime Profileに必要なcapabilityを再確認する。

gVisorまたは必須capabilityが利用不能な時、host executionまたはplain Dockerへsilent fallbackしない。Campaign preparation自体はdurableに記録し、Lab Baseline Builderがinfrastructure reason付き`setup-blocked`を返して未完了Campaignとして停止する。詳細なsetup lifecycleは[ADR 0101](0101-build-a-sealed-lab-baseline-before-research.md)に従う。

plain Dockerは、既知のsynthetic fixtureを使うharness開発とcontract/integration debuggingに限り、明示的なunsafe development modeで利用できる。その実行には`non-evidentiary`を記録し、Finding、Human Confirmation、Development Cohort合格、Sealed Evaluation結果へ昇格させない。

gVisorを使用しても、privileged container、host network、container engine socket、credential-bearing host path、unrestricted egressを許可しない。より強いKata ContainerまたはmicroVM backendは、互換性またはthreat model上の実需要が確認された時に追加する。
