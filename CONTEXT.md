# Research

特定versionのWordPressプラグインを対象に、攻撃面の把握、脆弱性仮説の探索、独立検証、学習の反復を行い、未知の重大侵害routeを発見するResearch context。

## Language

**Target Snapshot**:
plugin source、version、取得metadataを同一性に結び付けた不変の調査対象。
_Avoid_: Target、Plugin copy

**Canonical Configuration**:
pluginをinstall・activateし、公式手順に沿って最小限の通常機能を利用可能にした再現可能な設定。
_Avoid_: Default state、Test setup

**Configuration Variant**:
特定Hypothesisの成立に必要なoptional featureまたはstateを、Canonical Configurationとの差分と根拠付きで固定した設定。
_Avoid_: Special setup、Hidden premise

**Campaign**:
一つのTarget Snapshotに対して、目的、許可範囲、予算、停止条件を固定した一連の研究活動。
_Avoid_: Scan、Run

**Model Profile**:
一つのworker roleに対して、model identity、effort、tool policy、context policy、予算をversion固定した実行条件。
_Avoid_: Model、Provider config

**Prompt Set**:
Role Prompt、Campaign Policy、Work Assignment、selected Knowledgeを一つのworker入力へ決定的にrenderするversioned定義。
_Avoid_: Prompt file、Transcript

**Knowledge Capsule**:
Focus Areaとworker roleに必要なWordPress core、PHP/language、framework/plugin family、vulnerability mechanismの知識だけを選び、versionと由来を固定した入力。
_Avoid_: Cheatsheet dump、Model memory

**Oracle Leakage Gate**:
公開Finding由来の知識からtarget identity、affected version、固有symbol、payload、patch情報を除き、由来Case以外での有効性を確かめる昇格条件。
_Avoid_: Redaction only、Prompt secrecy、Benchmark tuning

**Context Request**:
workerがHypothesisまたはFocus Areaを閉じるために必要と判断した追加dependency sourceまたはartifactを、理由と用途付きで要求する記録。
_Avoid_: Network fetch、Wishlist without reason

**Development Cohort**:
prompt、rule、Model Profile、harnessを繰り返し調整するための、oracle既知の再現可能なCase集合。
_Avoid_: Evaluation set、Proof of capability

**Boundary Pair**:
同じCausal Identityについて、vulnerable Snapshotのpositive、actual patched Snapshotのnegative、通常機能が保たれるbenign controlを人間再現したbenchmark Case。
_Avoid_: Version pair、Synthetic negative

**Sealed Evaluation Cohort**:
候補構成を固定した後にだけ実行し、workerと開発者の調整loopからoracleを隔離する未使用Case集合。
_Avoid_: Development Cohort、Demo cases

**Permitted Attacker**:
認証なしの外部者、または管理者の個別判断なしに通常登録で取得できる最弱権限の利用者。WordPressのSubscriberと、対象構成におけるCustomerなど同等以下のroleを含む。
_Avoid_: Low-privilege user、Normal user

**Frontier Discovery Capability**:
既知脆弱性のoracleなしに、Permitted Attackerから任意code executionまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立した実証とHuman Confirmationまで到達できる能力。
_Avoid_: RCE detector、Benchmark recall、Static rule coverage

**Researcher Reference**:
公開Findingのportfolioから、目指す成果水準、mechanism coverage、benchmark gapを定める参照。研究者の非公開method、worker persona、prospective Campaignのoracleは含まない。
_Avoid_: Design reference、Expert prompt、Vulnerability oracle

**Researcher Reference Corpus**:
Researcher Referenceの公開Findingをattacker premise、surface、root cause、route shape、security propertyへ正規化したversioned集合。evaluation coverageに使い、prospective workerへは渡さない。
_Avoid_: Development Cohort、Knowledge Capsule、Discovery oracle

**Surface Map**:
Target Snapshotのentry point、trust transition、guard、state、sink、および関係を列挙した攻撃面の地図。脆弱性の主張は含まない。
_Avoid_: Threat model、Scan result

**PHP Program Index**:
固定Target Snapshotを実行せずに構文解析して得た、file digest、source range、symbol、call relation、WordPress registration、guard、source、storage、sink、parse diagnosticを持つcanonicalでversionedなJSON artifact。
_Avoid_: Parser object、Raw AST dump、Surface Map

**Focus Area**:
Surface Mapから切り出した、所有範囲と完了条件が重複しない探索領域。
_Avoid_: Agent task、Vulnerability class

**Work Lease**:
一つのFocus AreaまたはHypothesisを一つのworkerへ期限・予算付きで排他的に割り当てた記録。
_Avoid_: Prompt、Agent assignment

**Work Wave**:
開始前にWork Leaseと予算を固定した有限の並列作業集合。全Attemptがterminalになった後、結果を安定順で次の判断へ反映する。
_Avoid_: Open-ended swarm、Arrival-order batch

**Exploration Lane**:
探索portfolioの偏りを防ぐためFocus AreaまたはWork Leaseへ付ける目的区分。worker role、model identity、Verification Queueではない。
_Avoid_: Agent type、Model specialization、Queue

**Frontier Lane**:
複数のroute primitiveをつなぎ、RCEまたは同等のsite-wide compromiseへ至る可能性を探索するExploration Lane。
_Avoid_: RCE-only worker、Critical verdict

**Primitive Lane**:
SQL injection、Stored XSS、authorization、identity、file、path、deserialization等、単独でもchainの一部でも価値を持つsecurity-property破壊を探索するExploration Lane。
_Avoid_: Low-severity lane、Static rule lane

**Coverage Lane**:
未所有surface、未追跡relation、parse diagnostic、動的dispatch等のgapを調べ、Coverage Closureへ必要な証拠を作るExploration Lane。
_Avoid_: Filler work、Zero-finding lane

**Attempt**:
一つのWork Leaseを、一つの固定Model Profileとfresh contextで完了させようとする実行単位。独立性、予算、outcomeの境界となる。
_Avoid_: CLI process、Session、Retry

**Independent Reproduction**:
同じFrontier Hypothesisを、過去Attemptのconversation、scratch、payload、writable stateを使わず、freshなVerifierとLabで再導出してWitnessとCausal Controlを再現する試行。
_Avoid_: Retry、Session resume、Replay of prior payload

**Model Separation Exception**:
Frontier reviewで異なるmodel familyを割り当てられず、同じfamilyを再利用した理由と影響を残す記録。
_Avoid_: Silent fallback、Equivalent independence

**Segment**:
一つのAttempt内で起動した一回のprovider CLI process。分類済み一時障害から同じsessionをresumeするたびに新しいSegmentを追加する。
_Avoid_: Attempt、Campaign resume

**Agent Sandbox**:
一つのAttemptのnative agent processと許可toolだけを実行し、Target Snapshotをread-only、scratchをwriteableにした隔離zone。
_Avoid_: Verification Lab、Host process

**Verification Lab**:
固定runtime上でWordPress、plugin、database、browserを実行し、typed Experimentごとに破棄または既知stateへ戻す隔離zone。
_Avoid_: Agent Sandbox、Development environment

**Lab Baseline**:
WitnessとCausal Controlのsibling Labを生成する、runtime、Target Snapshot、configuration、seed stateをhash固定した起点。
_Avoid_: Running Lab、Docker image only

**External Dependency Grant**:
Verification Labが特定の外部serviceへ接続する必要性、最小接続範囲、test account、credential、記録、上限をCampaign開始前に固定したnetwork capability。
_Avoid_: Internet access、Domain allowlist only

**SecretRef**:
Credential Brokerが保持するsecretを値を露出せず参照するopaque identity。Ledgerにはscope、期限、receiptだけを残す。
_Avoid_: Token、Environment variable

**Credential Broker**:
External Dependency Grantに従い、専用test credentialを最終利用境界で注入し、rotation、revocation、redactionを記録するtrusted control-plane component。
_Avoid_: Secret file mount、Shared account

**Exploration Queue**:
coverage gap、novelty、expected information gain、探索費用から、次に調べるFocus Areaまたはgapを並べた作業列。
_Avoid_: Verification Queue、Global priority

**Verification Queue**:
potential impact、Permitted Attacker、route completeness、決定的Experimentの費用から、次に反証するHypothesisを並べた作業列。
_Avoid_: Exploration Queue、Global priority

**Hypothesis**:
特定のattacker premiseからsecurity impactへ至る可能性を、反証可能なrouteと不足証拠で表した未確認の主張。
_Avoid_: Lead、Candidate、Finding

**Evidence Route**:
一つのattacker premiseから一つのsecurity impactまでを、sourceまたはExperiment evidence付きの因果関係で結ぶ最小subgraph。Target全体のcall graphや自由文の攻撃物語ではない。
_Avoid_: Call graph、Transcript、Exploit narrative

**Route Fragment**:
同じTarget Snapshot内で複数Hypothesisが参照できる、連続したobserved Evidence Routeの一部。新しい接続関係やterminal impactを証明せず、Targetを越えてobserved stateを継承しない。
_Avoid_: Finding、Exploit primitive library、Global fact

**Frontier Gap**:
現在のEvidence RouteまたはRoute FragmentからFrontier Discovery Capabilityのimpactへ至るために必要な、未確認のessential causal relation。必要fact、falsifier、次の決定的Experimentを伴う。
_Avoid_: Confidence score、Missing-edge count、Speculation

**Source-bound Hypothesis**:
少なくとも一つの実在するentryまたはsecurity-relevant nodeをEvidence Route内でsource evidenceへ結び、unknown、falsifier、次のExperimentを明示したHypothesis。
_Avoid_: Suspicion、Idea

**Experiment**:
一つのHypothesisを支持または反証するために、事前にsuccess criterionを定めて行う再現可能な試行。
_Avoid_: Test、Probe

**Witness**:
Experimentがsecurity propertyの破壊を客観的に示した実行結果。
_Avoid_: Argument、Model verdict

**Execution Canary**:
使い捨てVerification Lab内だけでcodeまたはcommand executionを示す、一回限りのnonce付き無害effect。interactive access、外部egress、実data取得、永続backdoorを含まない。
_Avoid_: Reverse shell、Persistent payload、Host command

**Causal Control**:
Witnessと同じsurfaceおよび環境を使い、仮定した原因要素だけを除くことでsecurity propertyの破壊が消えることを示す比較結果。
_Avoid_: Benign sample、Unrelated negative test

**Finding**:
固定したTarget Snapshotに対し、独立Verificationがrouteを再導出し、cleanなlocal WordPress環境でWitnessとCausal Controlを確認した脆弱性。
_Avoid_: Hypothesis、Report

**Causal Identity**:
root cause、attacker-controlled primitive、破壊されるsecurity propertyの組で表すHypothesisまたはFindingの重複単位。
_Avoid_: File match、Vulnerability-class match

**Blocked**:
必要なsource、runtime、tool、または前提を取得できず、Hypothesisを支持も反証もできないVerification結果。
_Avoid_: Failed、Disproved

**Disproved**:
独立Verificationが、必要なroute、premise、security property、またはWitness条件の不成立を証拠付きで示したHypothesis結果。
_Avoid_: Blocked、Rejected

**Coverage Closure**:
すべてのin-scope Focus Areaが理由付きterminalとなり、独立したgap passを繰り返しても新しいsurface、Hypothesis、またはpriority変化が生じないCampaign状態。
_Avoid_: Timeout、Zero findings、Agent done

**Closure Record**:
一つのFocus Areaについて、所有surfaceを列挙し、それぞれをobserved、Hypothesis化、source根拠付きruled-out、または理由付きBlockedへ分類した完了証拠。
_Avoid_: Worker summary、Done flag

**Research Ledger**:
Hypothesis、Experiment、証拠、判断、費用、次の行動を因果関係ごと追跡できる追記型の研究記録。
_Avoid_: Transcript、Log

**Lesson**:
複数のHypothesisまたはCampaignで再利用できる、成功パターン、失敗パターン、探索上の判断規則。
_Avoid_: Prompt tweak、Anecdote

**Lesson Proposal**:
Campaign evidenceから導いた未昇格のLesson。Development CohortとSealed Evaluation Cohortを通過するまで他Campaignの実行policyを変更しない。
_Avoid_: Lesson、Automatic rule

**Rule Proposal**:
Verified FindingのCausal Identityを近い構文variantへ一般化した、未昇格のversioned static-analysis rule。Boundary Pair、benign corpus、人間reviewを通るまで他Campaignの実行結果へ影響させない。
_Avoid_: Finding、Accepted rule、LLM-generated answer

**Not Codifiable Record**:
Findingを現在のstatic-analysis capabilityでは意味のある精度のruleへ落とせないことを、失われるreasoningと必要capability付きで記録した成果物。
_Avoid_: Failed rule、Skipped work

**Accepted Static Rule**:
由来Finding、Causal Identity、engine/version、scope、limitを固定し、positive、patched negative、benign functional control、benign corpus、人間reviewのpromotion gateを通過したrule。matchはHypothesisだけを生成する。
_Avoid_: Finding、Automatic verdict、Rule Proposal
