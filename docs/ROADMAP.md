# Capability-first Roadmap

Status: accepted capability order; current progress belongs in the [Codebase Guide](CODEBASE-GUIDE.md)

ProductのNorth Starは、oracle-freeなprospective Campaignでhigh-impactなbroken security semanticsを発見し、source-only Validationで明らかなfalse positiveを抑え、Human Review PacketからHuman Verification済みFindingまで閉じる能力である。

日付、進捗率、対象plugin、実装file、次のticketはここへ置かない。現在地は[Codebase Guide](CODEBASE-GUIDE.md)、実測は[Experiments](experiments/README.md)、次の有限workはGitHub Issuesを正本とする。

## Capability order

| Order | Capability | Completion condition | Deliberately later |
| --- | --- | --- | --- |
| 1 | Closed mechanics | finite work、typed failure、artifact integrity、crash recovery、replayが一つのTargetで閉じる | 未知発見能力の評価 |
| 2 | Prospective semantic research | oracle-freeな最新Targetから重大Hypothesisまたはstrong frontierを得られる | 完全なMap、多数Target |
| 3 | Conditional depth | Fragment、Synthesis、Critic、fresh missing-link workがhigh-impact routeまたは根拠付きstopへ収束する | 全Targetへの常時Depth |
| 4 | Validation and Human Verification | fresh source reviewからReview Packetを作り、人間だけがFindingへ昇格する | submission、vendor連絡 |
| 5 | Target Intelligence | 手動経路を残してeligibility、ranking、acquisitionを自動化する | Research判断との混合 |
| 6 | Breadth and cost optimization | recall baselineを落とさないablationで多数Targetへscaleする | costを理由にした早期recall低下 |

## Operating constraints

- raw-source Semantic Researchを主経路にし、Surface Map、PHP Program Index、Semgrep、CodeQLは補助にする。
- 初期production探索は最大4つのfresh Finder Attemptで独立research thesisを保つ。Multi-modelはsingle-model baseline後のCanaryで評価する。
- Depth Admissionは既知の最終impactではなく、high-impactへ伸びるsource-bound frontierで決める。
- Validationは二つのfresh Attempt、material conflict時だけ三つ目、最後にtool-free Synthesisを使う。
- Human Verificationはfreshな隔離環境と実Target interfaceを使い、Researchの`ready-for-human`をFindingと扱わない。
- Target Intelligenceはknown-vulnerability情報をResearch inputから隔離する。
- cost最適化はFinder数、model、context量、Wave数、static prefilterを一変数ずつablationし、high-impact recallを落とさない場合だけ採る。

## Scope

現在のTargetはWordPress pluginである。Themes、WordPress Core、自動submission、vendor communication、patch generation、dashboardは最初のproduct goalではない。External Action AuthorizationはHuman Verificationと分離する。

systemの責任関係と各capabilityのruntime位置は[Harness Architecture](ARCHITECTURE.md)、判断原則は[Research Design](RESEARCH-DESIGN.md)を参照する。
