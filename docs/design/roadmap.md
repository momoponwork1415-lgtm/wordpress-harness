# Capability-first roadmap

Status: accepted design sequence, 2026-09-01

North Starは、oracle-freeのprospective CampaignでRCEまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立VerificationとHuman Confirmationまで到達する`Frontier Discovery Capability`である。各Milestoneはその能力へ至る段階であり、公開Caseの再発見だけを最終成果としない。

## Milestone 1 — one closed loop

Opus Model ProfileとClaude process adapter一つを使い、gVisor上のBrizy 2.8.11/2.8.12 Boundary Pairをend-to-endで完走する。

- manual Target import and immutable Campaign Spec
- deterministic Surface Map plus Mapper synthesis
- Focus Areas、parallel Finder、Hypothesis deduplication
- evidence state付きEvidence Routeによるmulti-file・cross-request chain表現
- Frontier、Primitive、Coverageの三Exploration Laneを持つdeterministic Work Wave
- independent Verifier、browser Witness、sibling Causal Control、Skeptic
- SQLite Research Ledger、private CAS、deterministic Work Waves
- crash resume and budget enforcement
- vulnerable positiveだけをFindingへ昇格
- digest固定したHuman Review Packetと、最小のHuman OS decision record

これはresearch mechanicsの合格であり、RCE discovery capabilityの証明ではない。

実装順は次に固定する。

1. event schema、SQLite Research Ledger、replay/crash test、最小`prepare/read/inspect`
2. pinned PHP helperとPHP Program Index
3. Opus native agent process transport
4. gVisor Verification LabとBrizy Witness/Causal Control
5. Human Review PacketとHuman Confirmationの記録

## Milestone 2 — measurable research capability

Development Cohortの四CaseをBoundary Pairとしてadmitし、GLM、Grok、GPT、OpusをMapper、Finder、Verifier、Skepticの全roleで最低3回ずつ評価する。

- Stored XSS、SQL injection、account takeover用typed Experiment adapters
- executable upload、command injection、dynamic PHP execution、object injection/gadget用のcanary-only RCE Experiment adapters
- target-bound Route FragmentとFrontier Gapによるchain探索・決定的priority
- Semgrep OSSを最初のengineとする独立Static Rule Lane
- Verified FindingからRule ProposalまたはNot Codifiable Recordを作る
- vulnerable positive、patched negative、benign functional control、benign corpusを通ったruleだけを昇格する
- static matchはHypothesisだけを生成し、通常の独立Verificationを省略しない
- CodeQLはPHPには使わず、Target Snapshot内の公式対応言語だけにcapability-gatedで使う
- role-specific benchmarkからend-to-end finalist比較への二段階評価
- Frontier Hypothesisの二回Independent Reproductionと、可能な限り異なるmodel familyによるreview
- Corpus由来Knowledge CapsuleのOracle Leakage Gate
- verified unique Findings、false promotion、closure、cost、wall time、varianceのvector
- prompt、Knowledge Capsule、priority、Lesson proposalのcontrolled iteration
- darooの公開portfolioをversioned Researcher Reference Corpusへ分類してmechanism coverage gapを測る。ただしworkerへCVE oracleを渡さない
- sealed Evaluation Cohortによるpromotion gate

RCEはprivate workspaceで人間がvulnerable/patched両側を再現してから追加する。Milestone 2を完了する前に、少なくとも一つのprivate RCE Boundary Pairと、Lab内の無害なcanaryだけを観測するtyped RCE Experiment adapterを成立させる。

## Milestone 3 — Target Intelligence

Wordfence Intelligence APIの定期取得、immutable observation、eligibility、ranking、Target acquisitionを独立contextとして追加する。

- API ingestion failureは進行中Campaignへ影響させない
- selection factsとknown-vulnerability oracleを分離する
- prospective workerへadvisory、CVE、patch narrative、case roleを渡さない
- Target Candidateからmanual reviewまたはpolicy gateを経て、Oracle Factを除いたTarget Intake Packetを作る
- ResearchがTarget Intake Packetのsourceをdigest固定してTarget Snapshotを作る

Target IntelligenceがなくてもMilestone 1と2はmanual Target importで運用できる。

## Milestone 4 — prospective frontier discovery

Development Cohort、rule library、既知advisoryからoracle-isolatedな最新Target SnapshotへCampaignを実行し、未知の重大routeを探索する。

- RCEおよび同等のsite-wide compromiseを最上位security goalとしてFocusする
- SQL injection、Stored XSS、account takeoverを独立impactとchain primitiveの両方として探索する
- agentic discovery、static rule-assisted discovery、human leadを分離してprovenanceを記録する
- Findingにはfresh Verification、Witness、Causal Control、Skepticを要求する
- Frontier Discovery Capabilityの達成判定にはHuman Confirmation済みのprospective Findingを要求する

## Later contexts and adapters

Programme eligibility、submission drafting、vendor communication、patch generationはresearch capabilityとTarget Intelligenceの外側に置き、Human OSの明示的なExternal Action Authorizationへ接続する。web dashboardとremote controlはHuman OSおよびResearchを操作するadapterであり、独立したdomain contextにしない。
