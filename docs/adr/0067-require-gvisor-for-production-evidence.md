---
status: accepted
---

# Require gVisor for production evidence

Linux上のproduction isolation backendはgVisorのOCI runtimeである`runsc`に固定する。Agent SandboxとWordPress Verification Labを通常の`runc`ではなく`runsc`で起動する。deployment capability probeとCampaign setupで、digest固定したRuntime Profileに必要なcapabilityを確認する。

gVisorまたは必須capabilityが利用不能な時、host executionまたはplain Dockerへsilent fallbackしない。Lab setupはinfrastructure reason付き`setup-blocked`として停止する。setup lifecycleの正本は[Campaign Setup Seam](../design/campaign-setup-seam.md)とする。

plain Dockerはsynthetic fixtureを使う非evidentiaryなharness開発だけに限定し、Finding、benchmark合格、production evidenceへ昇格させない。

gVisorを使用してもprivileged container、host network、container engine socket、credential-bearing host path、unrestricted egressを許可しない。より強いisolation backendは実需要が確認された時だけ追加する。
