---
status: superseded by ADR 0125
---

# Separate breadth and depth Campaign policies

多数Targetから短い脆弱性を効率よく得る広域Campaignと、一つのTargetで複数primitiveを高impact chainへ接続する深掘りCampaignを、別のadmission、scheduler、model allocation、停止条件、評価指標として実装する。Wordfenceの名称をrepositoryのModule名にせず、それぞれ`breadth`と`depth`のCampaign Modeとする。

BreadthはTarget Intelligence、Semgrep/CodeQL、Surface Map、cheap/medium Model Profileを候補seedとcoverageへ積極利用し、短いsource-to-sink route、precision、targets/hour、costを最適化する。Depthは一Targetを固定し、raw-source Context Profile、高推論Model、Approach Family Registry、Root Synthesis、Adversarial Critic、missing-link Wave、Dependency Wishlistを使い、chain closure、高impact frontier progress、time-to-proofを最適化する。現段階の主探索はDepthであり、Breadthを必ず先に通すpipelineにはしない。

両Modeが共有するのはTarget Snapshot、Provider Adapter、隔離、bounded Source Tools、typed artifact、CAS/Ledger、Independent Verification、gVisor Labである。BreadthのFindingまたはRoute Fragmentは自動的にDepthの答えにせず、impact potential、novel capability、unresolved chain、Target valueを持つDepth Admission artifactとして引き渡す。Depthの探索policyをBreadthのstatic coverage指標で閉じない。

Depthで独立検証されたFindingはPattern Extractionへ渡す。構文的に一般化でき、positiveとnegative fixtureで境界を検査できる場合だけSemgrep/CodeQL ruleへ昇格し、Breadthの安価なcoverage floorにする。wrapper、cross-request state、business logic、複数primitiveの意味接続を一つのruleで表せない場合は、途中primitiveをseedとして残し最終判断をDepthへ戻す。rule non-matchはDepth候補の反証またはCampaign closureに使わない。

この判断は、Wordfenceが公開するPRISMのbreadthとArgusのdepthの役割差を設計上も分離し、Semgrep-first実務で確認されたscale上の強みとwrapper/state/multi-step上の弱みを混同しないためである。

> ADR 0117以後、全Targetを最初からDepth Campaignへ入れる運行は標準ではない。raw-source-firstのSemantic Research Waveを通常運転とし、strong semantic frontierがある場合だけDepth Admissionから本ADRのDepth policyへ昇格する。BreadthとDepthを別policyにする判断自体は維持する。
