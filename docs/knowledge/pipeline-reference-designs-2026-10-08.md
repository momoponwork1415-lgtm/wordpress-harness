# 調査資料: AI脆弱性探索パイプラインの公開参照設計

状態: 一次資料に基づく比較。取得日は2026-10-08。公開日のないdocsは取得日で示す。既存note（[参考ハーネスの比較](reference-harness-observability.md)、[安価なモデルの将来志向探索](cheap-model-prospective-vulnerability-discovery-2026-09-16.md)、[多数報告者の探索手順](high-volume-wordpress-researcher-workflows-2026-09-13.md)）にある事実は繰り返さず、新しい事実と設計上の差分だけを記す。

## 結論

1. **公開設計は2つの型に分かれる。**
   - **固定段階のpipeline:** Mandiant AVDH、Cloudflare VDH / VVS、Codex Security plugin、Google Mantis、TitanCA。段階の順序をHarnessが持つ。
   - **最小scaffold + 独立verifier:** Anthropic Mythos scaffold / find-and-fix loop、Naptime / Big Sleep、XBOW。探索の進め方はagentに任せ、検証の独立性と隔離だけを構造で強制する。
2. **自動のPoC実行は、大半の設計で人間レビューより前にある。** Codex Security Cloud、Cloudflare、XBOW、Big Sleep、Mythos scaffold、Mantis、Anthropic loopが該当する。例外は3つある。AVDHはAIの静的な相互反証の後で人間がPoCを動的に再現する。Glasswingの外部triageでは人間の調査会社が再現する。Codex Security pluginのbacklog triageは、静的triageの後に人間が`needs_review`を選んでからvalidationへ進む。このrepositoryの「人間が採否を決め、Harnessが新しい環境で一度だけ実行時検証する」順序は例外側に近い。ただし人間が手で再現しない点はどの参照設計とも違う。
3. **偽陽性を減らす方法は5つに収束する。**
   - 探索と検証の分離（finderに自分の結果を採点させない）
   - threat model / trust境界の明示
   - 実行できるPoCまたはcanary
   - 反証役
   - 段階ごとのfunnel計測

   「PoCが失敗したら偽陽性」とはしない点で、Anthropic、Mantis、Chromeは一致する。これは本repositoryの`incomplete`と整合する。AVDHは逆に、動的試験を通らない候補を破棄する。
4. **oracle-freeと衝突する要素がある。** 過去のCVEや修正commitを、threat model、knowledge base、seed、照合DBに使う設計が多い。Anthropicのthreat model bootstrap、Mantisの`mantis-history`、Chromeのknowledge base、Big Sleepのvariant analysis、TitanCAのMatcher、AVDHのvulnerability ruleが該当する。
5. **推奨（Inference）。**
   - **第一参照:** Anthropic find-and-fix loopとMythos scaffold。agent裁量、独立verifier、gVisor / microVM隔離、「PoC失敗は偽陽性の証明ではない」という原則が、本repositoryの制約と最もよく両立する。
   - **第二参照:** Google Mantisの記録契約だけを採る。段階グラフは採らない。
   - **最大の差:** 人間ゲートの位置。合わせるなら、自動の新環境検証をHuman Candidate Reviewの前へ移す必要がある。これはAGENTS.mdとADR 0135の変更を要する。

## 証拠の境界

- **Observed:** 提供者の公式記事、公式docs、公式GitHubの固定commitで確認した事実。URLを付ける。
- **Inference:** このrepositoryへの判断。採用決定ではない。採用には[変更gate](../RESEARCH-DESIGN.md#change-gate)とIssueを使う。
- **二次資料の扱い:** 一次資料が見つからない場合に限り使い、「二次」と明記する。
- **外部の数値:** 各社の自己申告で、WordPressでの再現率を示さない。

| 対象 | 一次資料（公開日） | 限界 |
| --- | --- | --- |
| OpenAI Aardvark / Codex Security | [Introducing Aardvark](https://openai.com/index/introducing-aardvark/)（2025-10-30、2026-03-06追記）、[Codex Security research preview](https://openai.com/index/codex-security-now-in-research-preview/)（2026-03-06）、docs: [Cloud FAQ](https://learn.chatgpt.com/docs/security/faq)、[Threat model](https://learn.chatgpt.com/docs/security/threat-model)、[Scans](https://learn.chatgpt.com/docs/security/plugin/scans)、[Deep scans](https://learn.chatgpt.com/docs/security/plugin/deep-scans)、[Triage backlog](https://learn.chatgpt.com/docs/security/plugin/triage-backlog)、[Plugin changelog](https://learn.chatgpt.com/docs/security/plugin/changelog)（docsは取得日2026-10-08。changelogは2026-09-24の0.1.30まで） | system cardに脆弱性探索pipelineの記述は見つからなかった。Cloud版の内部実装は非公開。 |
| Mandiant AVDH | [Staying Ahead of Adversarial AI](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)（2026-08-18） | 公開codeなし。2026-10-08時点で後続の公式記事は確認できない。 |
| Cloudflare VDH / VVS / VDR | [Project Glasswing: what Mythos showed us](https://blog.cloudflare.com/cyber-frontier-models/)（2026-05-18）、[Build your own vulnerability harness](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)（2026-06-18）、[Vulnerability Discovery and Remediation](https://blog.cloudflare.com/vulnerability-discovery-remediation/)（2026-09-03）、[security-audit-skill `c1c8a8c`](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8)（2026-09-14。2026-10-08時点でも最新） | VDH / VVS本体のcodeは未公開。 |
| Anthropic Glasswing / Mythos | [Mythos Preview](https://red.anthropic.com/2026/mythos-preview/)（2026-04-07）、[Glasswing initial update](https://www.anthropic.com/research/glasswing-initial-update)（2026-05-22）、[Using LLMs to secure source code](https://claude.com/blog/using-llms-to-secure-source-code)（2026-05-27）、[CVD dashboard](https://red.anthropic.com/2026/cvd/)（2026-10-02時点の集計）、[Claude Security plugin docs](https://code.claude.com/docs/en/claude-security)（取得日2026-10-08） | Mythos scaffoldはC/C++中心で、ASanという強い判定器がある。logic bugでは同等の判定ができないと本文が認める。 |
| Google Naptime / Big Sleep / Chrome / Mantis | [Project Naptime](https://googleprojectzero.blogspot.com/2024/06/project-naptime.html)（2024-06）、[From Naptime to Big Sleep](https://googleprojectzero.blogspot.com/2024/10/from-naptime-to-big-sleep.html)（2024年、URLは2024/10）、[Chrome: stronger with every update](https://blog.google/security/chrome-stronger-with-every-update/)（2026-07-30）、[Chromium AI-generated security bugs FAQ](https://chromium.googlesource.com/chromium/src/+/main/docs/security/ai-generated-security-bugs-faq.md)（2026-04）、[Mantis blog](https://cloud.google.com/blog/products/identity-security/getting-started-with-the-mantis-harness-to-find-and-fix-bugs)（2026-09-02）、[google/mantis `2b3bbdc`](https://github.com/google/mantis/tree/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80)（2026-10-06） | Big Sleepの2026年版architectureは公開されていない。2026年の公式記述はChrome記事だけで、そこでもBig SleepとCodeMenderをまとめて述べる。Mantisは「demonstration purposes only」とされる。 |
| TitanCA | [arXiv 2604.17860 v3](https://arxiv.org/html/2604.17860)（v1 2026-04-20、v3 2026-08-24） | 論文のみ。PoC実行と人間レビューの記述はない。 |
| XBOW | [Top 1](https://xbow.com/blog/top-1-how-xbow-did-it)（2025-06-24）、[We ran 1,060 autonomous attacks](https://xbow.com/blog/we-ran-1060-autonomous-attacks)（2026-03-02）、[Assessment Guidance](https://xbow.com/blog/introducing-assessment-guidance)（2026-03-12）、[IDOR](https://xbow.com/blog/xbow-finds-idors-high-accuracy-ambiguous-context)（2026-05-28）、[validation-benchmarks](https://github.com/xbow-engineering/validation-benchmarks)（README更新2026-07） | 製品本体は非公開。主にblack-boxのWeb pentestで、source-first探索ではない。 |

## 比較表

「前 / 後」は、自動のPoC実行（validation）が人間レビューの前か後かを示す。

| 対象 | 段階分解 | 段階ごとに残す記録 | PoC実行 vs 人間レビュー | 人間が判断する点 | 偽陽性削減 | 固定段階 / agent裁量 | 公開ソース |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aardvark / Codex Security Cloud | Analysis（threat model）→ Commit scanning → Validation → Patching | 編集できるthreat model、各findingのvalidation成否・log・command・artifact、失敗したvalidationの試行記録、scanごとのtoken / cost | **前**。再現できたfindingに`validated`を付けて人間へ出す | threat modelの編集、criticalityの修正、patchのPR化 | rank → 隔離containerでの再現。criticalityの修正をthreat modelへ反映 | 固定段階 | Cloudは非公開。plugin / CLI / SDKは[公開](https://github.com/openai/codex-security) |
| Codex Security plugin | Threat modeling → Discovery → Validation → Impact / path → Reporting →（Hardening）→ Finalization | `scan-manifest.json`、`findings.json`、`coverage.json`、`report.md`。coverageは`complete`、`partial`、`unavailable`の3値 | **前**（scan）。backlog triageは静的に判定し、validationは**人間の選択後** | 対象・model・追加contextの指定、coverageと証明の欠落の確認、findingの採否、偽陽性として閉じる理由 | `confirmed` / `not_actionable` / `needs_review`。偽陽性の理由を後のscanへ持ち越す | 「in order」の固定段階。deep scanは停止規則を設定で持つ | [公開](https://github.com/openai/codex-security) |
| Mandiant AVDH | Explorer → Specialist Explorer → Threat Model Synthesis →【人間承認】→ Discovery → Enrichment → Access Control / Data Flow → Confidence Filter → 多数Validation + Synthesis → dedup / risk rate →【人間による動的検証】 | threat modelの文章と図、優先順位とriskを付けたfinding一覧。各段階の永続記録は記述がない | **後**。AIは静的に検証し、人間がPoCを実行する | threat modelの承認、Confidence Filterの閾値、PoCの再現、開示判断 | 高temperatureの複数validatorと統合役（Confirmed / Disproven / Rejected）、consultant由来のrule階層 | 厳密に決定論的な逐次pipeline（「waterfall」） | なし |
| Cloudflare VDH / VVS / VDR | VDH: Recon → Hunt → Validate → Gapfill → Dedup → Trace → Feedback → Report（4〜8は生産者・消費者loop）。VVS: Dedup → Judgment → Fixing | SQLiteへ`(run_id, repo, stage)`で保存。findingは逐次保存。funnelの区分: raw / needs repro / rejected / duplicate / survived / elsewhere。agentの不足要求を書くwishlist | **前**。PoC testがないfindingは偽物扱い | 不足環境の提供（wishlist）、fix branchのreview、VDRでは自社teamの確認後に顧客review | threat modelを先に書かせるschema順序、未改変codeへのPoC、決定論的なpath検査、新規findingを出せないValidator、別modelのVVS | 固定段階。ただしHunterのsibling fork、Reconによる独自attack classなど段階内はagent裁量 | skillのみ |
| Anthropic Mythos scaffold / Glasswing CVD | Claude Codeの一段落prompt（「find a security vulnerability」）→ agentが読む・仮説を立てる・実行して確かめる → 報告とPoC → 別agentで「real and interesting?」→ 人間triage → 開示 | SHA-3-512 commitment ledger。公開は段階的に進む。重大度は3つの評価元（Claude / triage firm / maintainer）で記録 | **前**（agentが実行して確認する）、その後に人間が再現 | 外部firmによる再現・重大度・報告。direct disclosureでは同等の独立確認を省く | 実行による確認、最終検証agent、file順位付けで重複を抑制 | agent裁量。Harnessはcontainer、file割当、最終検証だけ | 後継の[reference harness](https://github.com/anthropics/defending-code-reference-harness)（既存note参照） |
| Anthropic find-and-fix loop / Claude Security plugin | 準備: Threat model → Sandbox。loop: Discovery → Verification → Triage → Patching | `THREAT_MODEL.md`。pluginはRESULTS.md / jsonl / sarifと、commit・effort・未commit変更・検証の深さを記すrevision stamp | **前**。独立verifierのPoC実行後に人間がtriageする | threat modelの面談、triage、patch適用 | 探索と検証の分離、新しいcontainerのverifier、反証prompt、複数verifierの多数決、PoC要求 | loopは固定。discoveryの方法はagentに任せる | [reference harness](https://github.com/anthropics/defending-code-reference-harness)（保守終了） |
| Google Naptime / Big Sleep / Chrome | Naptime: Code Browser / Python / Debugger / Reporter → Controllerが成功条件を検証。Big Sleep: 修正commitをseedにしたvariant analysis。Chrome 2026: KB + SECURITY.md + 別contextのcritic + 複数run → 自動triage（filter → 再現 → enrich → 担当割当） | trajectory、Controllerの検証結果。WAI / Not Reproducibleで閉じたbugを評価caseへ再利用 | **前**（二次資料によれば、AIが再現した後に専門家が報告前に確認） | 報告前の専門家確認、重大度の修正、偽陽性の閉鎖 | 自動検証（crash条件）、複数の独立trajectory、SECURITY.md、critic | Naptimeは少数の道具とagent裁量。Chromeは自動triageの固定段階 | Naptime / Big Sleepは非公開 |
| Google Mantis（追加） | history → structural index → architecture → threat model → plan → researcher → dedupe → review → critic → reproduce → chain → patch → calibrate → reflect → report | `workspace/findings/<id>.json`の各status、`learnings.jsonl`、`plan.json`、追記専用の`snapshot_history`、findingごとの`discovery_commit` | **前**。ただし報告前に専門家の手動確認を必須とする | 報告前の専門家確認、loopの停止時期、SKILL.md自動変更の承認 | review / critic、3段階の再現（Tier 3だけが`reproduced`）、fail-closedのdedup、risk calibration | 既定は逐次pipeline。`--objective`でagent graphを合成でき、`plan.json`をAIが更新する | [Apache-2.0](https://github.com/google/mantis/tree/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80) |
| TitanCA | Matcher（既知脆弱関数との類似）→ Filter（R2Vul）→ Inspector（4役の審理）→ Adapter（PairVul） | moduleの判定とconfidence。展開時の偽陽性をAdapterの学習信号にする | 記述なし（PoC実行の記述がない） | 記述なし。最終確認はmaintainerの修正による | 安いfilterを先に置く、校正済みconfidence、Researcher / Code Author / Moderator / Review Boardの審理 | 固定段階 | 論文のみ |
| XBOW | 攻撃面mapping → coordinatorによる優先付け → 短命solver（多数）→ validator | 記述は少ない。提出後の転帰（resolved / triaged / duplicate / informative / N/A）を公開 | **前**。validatorを通ったものを人間が提出前に確認 | 提出前review（HackerOne方針への準拠）、Assessment Guidance（surface / priorities / strategy / validation canary） | 決定論的validator（例: headless browserでのXSS実行）、IDORはrole baselineに基づく賛否推論、canary token | coordinatorとsolverはagent裁量。validatorは決定論的 | benchmarkだけ公開（README上で飽和） |

## 新しく確認した事実

### OpenAI Aardvark / Codex Security

- **Observed:** Aardvarkの4段階はAnalysis、Commit scanning、Validation、Patchingである。Validationでは隔離sandbox内でtriggerを試みる。PatchはCodexが生成し、Aardvarkがscanしたものを「for human review」で添付する（[Aardvark](https://openai.com/index/introducing-aardvark/)）。
- **Observed:** Codex Securityはthreat modelを編集可能にした。project固有の環境を設定すれば「running system」で検証し、動くPoCを作れる。findingのcriticalityを修正すると、threat modelと後のrunの精度へ反映される（[research preview](https://openai.com/index/codex-security-now-in-research-preview/)）。
- **Observed:** Cloud版の流れは「model ranks → auto-validation in a clean container」である。docsは、再現したfindingを`validated`とすることで「reduce false positives before human review」と述べる。失敗したvalidationでも、試した内容をlogとreportに残す（[Cloud FAQ](https://learn.chatgpt.com/docs/security/faq)）。threat modelの変更は「future scans」にだけ適用する（[Threat model](https://learn.chatgpt.com/docs/security/threat-model)）。
- **Observed:** pluginは「A scan runs these phases in order」と明記する固定段階である（[Scans](https://learn.chatgpt.com/docs/security/plugin/scans)）。backlog triageは各findingを「unproven claim」としてcodeを実行せずに判定する。validationは`needs_review`を人間が選んだ後に行う（[Triage backlog](https://learn.chatgpt.com/docs/security/plugin/triage-backlog)）。
- **Observed:** changelogに次の変更がある（[changelog](https://learn.chatgpt.com/docs/security/plugin/changelog)）。
  - 0.1.15（2026-07-30）: 偽陽性として閉じる時に理由を記録し、後のscanへ持ち越す。
  - 0.1.16（2026-08-04）: usageを`complete` / `partial` / `unavailable`で示し、欠損を0にしない。
  - 0.1.20（2026-08-17）: deep scanの既定値は4 worker、新規なし4連続で停止、上限40 run。
  - 0.1.22（2026-08-25）: `verify-fix`は`fixed` / `still_vulnerable` / `inconclusive`を返す。

### Mandiant AVDH

- **Observed:** ADKの上で「strictly deterministic manner」により逐次実行し、各段階を完了してから次へ進む（[記事](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)）。
- **Observed:** threat model完成後に、consultantが文章と図を確認する「approval gate」がある。
- **Observed:** Discoveryはin-scopeの全fileをGemini Flash Liteで処理し、entry pointとinput sourceを抽出する。Enrichmentはentry pointごとにcontextを集め、Access ControlとData Flowのどちら（または両方）へ送るかを決める。仮説生成では自己検証を最小にし、consultantが設定するConfidence Filterで量を絞る。
- **Observed:** 検証は高temperatureの複数Validation agentとValidation Synthesisで行う。結果はConfirmed / Disproven / Rejectedのいずれかで、Rejectedはthreat modelと整合しないものを指す。
- **Observed:** 人間の専門家がPoCを動的に再現し、通らないfindingは破棄する。false negative対策として、consultantの知見をdomain、language、framework、vulnerabilityの階層ruleにしている。
- **Observed:** 評価には非公開の合成codebaseを使う。Grading agentが正解と厳密に照合し、別agentが偽陽性と重複を判定し、最後に人間がgradingを確認する。

### Cloudflare VDH / VVS / VDR

- **Observed:** VDHは8段階を持ち、4〜8段階目は生産者・消費者の連続loopとして動く。全段階がSQLiteへ`(run_id, repo, stage)`の単位で書く。findingは発生時に保存するため、crashしても失うのは実行中のtaskだけである（[Harness記事](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)）。
- **Observed:** 200 OKの応答本文に一時的なAPI errorが返る場合がある。本文を分類しないと、空のrunを成功として記録してしまう。また、findingが0件で早く終わったHunterは「shallow」として再投入する（同記事）。
- **Observed:** funnelは「raw candidates / needs repro / rejected at validation / duplicates / survived / went elsewhere」に分けて計測する。初期validationでの棄却率はRecon改善により40%から11%へ下がった。Cloudflare自身は再現率を主張しない（同記事）。
- **Observed:** Wishlistは、PoC確認用のVMなど不足する道具をagentが要求する仕組みで、128 repoで25,472回使われた。人間が依存を用意すると同じtaskを再実行する。一方、Semgrepを組み込んだが、Hunterは1か月で一度も呼ばなかった（同記事）。
- **Observed:** VDR（2026-09-03）では、model外の検査に失敗した提案を顧客reviewの前で止める。自社teamが検証するまで何も提示せず、modelは提案したpatchやruleを適用できない（[VDR記事](https://blog.cloudflare.com/vulnerability-discovery-remediation/)）。

### Anthropic Glasswing / Mythos / find-and-fix loop

- **Observed:** Mythosのscaffoldは次のとおりである（[Mythos Preview](https://red.anthropic.com/2026/mythos-preview/)）。
  - internetから隔離したcontainerでClaude Codeを起動し、ほぼ「find a security vulnerability」だけのpromptを与える。
  - agentはcodeを読み、仮説を立て、projectを実行して確かめ、「bugなし」または「報告とPoC」を返す。
  - fileの有望度を1〜5で順位付けし、file別agentを並列に走らせる。最後に別agentが「real and interesting?」を判定する。
  - logic bugでは「(near-)perfectly validate」できなくなると本文が述べる。
  - 人間による審査要件を緩める場合は、事前に公表すると約束している。
- **Observed:** CVD dashboard（2026-10-02時点）の集計は次のとおりである（[CVD dashboard](https://red.anthropic.com/2026/cvd/)）。
  - candidate 29,439件、外部firmのreview 6,123件、有効5,674件（92.7%）。
  - 外部triageを経ない「Direct disclosure」経路があり、「may contain false positives」と明示する。
  - 各findingをSHA-3-512のcommitment hashで先に記録し、開示が進むにつれて詳細を公開する。
- **Observed:** Glasswing更新では、triageは「再現と重大度の再評価 → 既存修正の確認 → 報告」の順で進む。公開したtoolはskill、harness（codebase mapping、scanning subagent、triage、report）、threat model builderである（[initial update](https://www.anthropic.com/research/glasswing-initial-update)）。
- **Observed:** find-and-fix loopは、threat modelとsandboxを一度準備した後、discovery、verification、triage、patchingを繰り返す（[Using LLMs to secure source code](https://claude.com/blog/using-llms-to-secure-source-code)）。要点は次のとおりである。
  - discovery promptは目的とcontextを与え、方法をmodelに任せる。長いchecklistは新規bugを減らす。
  - discoveryとverificationを同じagentにさせると、真陽性まで自己検閲してしまう。
  - verifierは共有filesystemも会話履歴もない新しいcontainerで動かし、findingまたはPoCとcodebaseだけを渡す。
  - 反証役のverifierで、悪用できないfindingの率がおよそ半分になり、PoCを要求すると偽陽性がほぼ0になった。
  - 「failure to produce a working PoC is not proof of a false positive」。
  - 再現できないfindingも未証明として報告し、再現率を保つ。
- **Observed（oracle衝突）:** 同じ記事は、threat modelの初期化に過去の脆弱性とgit historyを使い、過去bugの型をhintにすることを勧めている。
- **Observed:** Claude Security pluginは、独立したverifier agentの分析を経たfindingだけを報告に載せる。revision stampにはcommit、effort、未commit変更の有無、検証の深さを記録する。codeが変わったfindingはpatch対象から外す（[plugin docs](https://code.claude.com/docs/en/claude-security)）。

### Google Naptime / Big Sleep / Chrome / Mantis

- **Observed:** Naptimeの原則は「Space for Exploration、Interactive Environment、Specialised Tools、Perfect Verification、Sampling Strategy」である。一つのtrajectoryで複数の仮説を扱うのは非効率なので、独立したtrajectoryを複数sampleする。ReporterがControllerへ成功条件の検証を依頼する（[Naptime](https://googleprojectzero.blogspot.com/2024/06/project-naptime.html)）。
- **Observed:** Big Sleepは、修正commitのmessageとdiffをseedにしたvariant analysisである（[Big Sleep](https://googleprojectzero.blogspot.com/2024/10/from-naptime-to-big-sleep.html)）。**二次:** Googleの広報は「human expert in the loop before reporting」、各bugは「found and reproduced by the AI agent」と述べた（[TechCrunch 2025-08-04](https://techcrunch.com/2025/08/04/google-says-its-ai-based-bug-hunter-found-20-security-vulnerabilities/)）。
- **Observed:** Chromeが2026年に作ったharnessは次の要素を持つ（[Chrome](https://blog.google/security/chrome-stronger-with-every-update/)）。
  - 過去の全CVEとgit historyを含むknowledge base。
  - SECURITY.mdを読む別contextのcritic。
  - model非決定性に備えた複数run。
  - 自動triage（filter → PoC再現 → metadata付与 → 担当者割当）。
- **Observed:** ChromeのFAQによれば、AIが出したbugのすべてで人間が重大度を確認したわけではない。PoCは後から付けている。WAIやNot Reproducibleで閉じたbugを評価caseに使う（[FAQ](https://chromium.googlesource.com/chromium/src/+/main/docs/security/ai-generated-security-bugs-faq.md)）。
- **Observed（Mantis）:** READMEは「All findings must be manually verified by a security expert before being reported」と、「failure to automatically reproduce ... does not definitively mean it is a false positive」を明記する。記録と検証の規則は次のとおりである（[README_AGENTS](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/README_AGENTS.md)）。
  - findingは`discovery_commit`へ結び付け、それが現在のsnapshotと一致する時だけ、棄却・再現・patchの判定を行う。
  - snapshotを固定できない時（HALT）は`not_attempted` / `VERIFICATION_INCOMPLETE`に留め、否定の結論を出さない。
  - 再現はTier 1（単体）、Tier 2（subsystem）、Tier 3（隔離環境の全service）で行い、Tier 3だけが`reproduced`を出せる（[reproduce SKILL](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-reproduce/SKILL.md)）。
  - dedupで決定的に一致しないものは新しいIDを付けて別件に保つ（fail-closed）。
  - 知識にはtrust tier（`unverified` / `heuristic` / `machine_confirmed` / `human_reviewed`）を付ける。
  - 本番では、agentが呼び忘れられない決定論的harnessでskillを包むよう推奨する。

### TitanCA / XBOW

- **Observed:** TitanCAでは、Matcherが既知脆弱関数DBと一致したfunctionに後段を省略させる。InspectorはSecurity Researcher、Code Author、Moderator、Review Boardの4役で審理する。高価な審理を安いfilterの後に移して費用を下げた。precisionを重く見るF0.3で評価する（[TitanCA v3](https://arxiv.org/html/2604.17860)）。
- **Observed:** XBOWは、永続coordinatorが多数の短命agentを指揮し、決定論的logicで検証する。発見したsystemが確認も行うことはない（[2026-03-02](https://xbow.com/blog/we-ran-1060-autonomous-attacks)）。
- **Observed:** IDORでは、まずroleごとに正常な操作を観察するagentを走らせ、validatorはその観察に照らして賛否を論じる（[IDOR](https://xbow.com/blog/xbow-finds-idors-high-accuracy-ambiguous-context)）。LFIやSQLiの確認には、fileやDBに置いたcanaryを取得させる（[Assessment Guidance](https://xbow.com/blog/introducing-assessment-guidance)）。
- **Observed:** HackerOneへの提出前に人間がreviewした。転帰は1,060件中、duplicate 208件、informative 209件、N/A 36件だった（[Top 1](https://xbow.com/blog/top-1-how-xbow-did-it)）。
- **Observed:** benchmarkは、build時にflagを注入する104問のCTFである。READMEは2026年中頃に飽和したため、履歴保存用と明記する（[validation-benchmarks](https://github.com/xbow-engineering/validation-benchmarks)）。

## このリポジトリとの差分

| 観点 | 現行（[探索設計](../RESEARCH-DESIGN.md)） | 参照設計の多数派 | 差 |
| --- | --- | --- | --- |
| 段階 | Rootが探索を所有する。Harnessは安全上限とgateだけを持つ | 固定段階（AVDH / Cloudflare / Codex plugin / Mantis / TitanCA） | 本repositoryはAnthropic型・XBOW型のagent裁量側にある。固定段階は採れない |
| threat model | Programme Research Boundaryと攻撃者allowlist。独立した成果物はない | ほぼ全てがthreat modelを最初の成果物にする（Codexは編集可、AVDHは人間承認） | trust境界を明示した入力または成果物がない |
| 検証と人間の順序 | Root stop → Human Candidate Review → 新しいLabで一度だけrecipeを実行 | 自動のPoC検証 → 人間（AVDHとGlasswing triageは人間が再現） | 人間は実行時証拠なしで採否を決める |
| verifierの独立性 | RootがrecipeをResearch内で作り、Human OSは実行だけを担う（[ADR 0135](../adr/0135-promote-candidates-through-runtime-verification.md)） | 新しいcontainer、finding / PoCだけを渡す、反証を試みるverifier | recipeの作成者とfinderが同一。Labでの修復・反証役はいない |
| 失敗の意味 | `incomplete` ≠ `contradicted` | Anthropic / Mantis / Chromeが一致。AVDHは破棄 | 一致 |
| oracle | 既知脆弱性を渡さない | 過去のCVE / 修正履歴をseed、KB、照合に使う設計が多い | それらの要素は採れない |

## このリポジトリが合わせるなら

以下はすべて**Inference**であり、採用決定ではない。

### 推奨1: Anthropic find-and-fix loop + Mythos scaffold（主参照）

両立する理由:
- discoveryの方法をagentに任せる。
- verifierの独立性と隔離を構造で強制する。
- PoC失敗を偽陽性にしない。
- gVisorによる隔離がある。

合わせる時に変えること:

1. **自動検証を人間レビューの前へ移す。** Programme Boundaryのhard gateを通ったCandidateには、Human Candidate Reviewの前にfreshなCandidate Verificationを自動で一度だけ実行する。人間は`runtime-confirmed` / `contradicted` / `incomplete`の証拠を見て採否を決める。実行時検証は使い捨てのLab内で完結し、外部行動ではない。人間ゲートは「検証の実行」から「提出候補へ進める判断」へ移る。必要な変更は次のとおり。
   - ADR 0135を置き換える新しいADR。
   - AGENTS.mdの「Human Candidate Reviewで採用された候補だけを…Candidate Verification Requestとして」という記述。
   - 回帰testの「人間の候補採否 → 一度だけの動的検証」。

   利用者記憶の「人間の承認品質に依存しない仕組みにする」とも整合する。
2. **verifierを独立させる。** recipeをRootの作業成果物として保ちつつ、Lab側に新しいverifierを置く。verifierにはCandidate本文、recipe、Target Snapshotだけを渡し、会話や作業領域は渡さない。verifierの役割は、recipeの環境不備を直すことと、主張を反証することに限る。これは「別のAI runでソースから脆弱性を探し直すことはしません」（[探索設計](../RESEARCH-DESIGN.md#candidate-verification)）を変える。再探索は禁止したままにし、許す操作を「同じ主張の再現と反証」に限定する境界の設計が要る。
3. **trust境界を明示する。** Anthropicの「Name what is trusted」、ChromeのSECURITY.md、Codexの編集できるthreat modelに相当する人間の宣言を、Programme Research Boundaryへ加える。例は「administratorと`unfiltered_html`は信頼する」「admin-onlyの経路は対象外」である。既知脆弱性ではなく信頼の前提なのでoracle-freeを保てる。CandidateのRootとverifierに同じ版を渡す。
4. **採らないもの:** 過去のCVEや修正commitによるthreat modelの初期化、bug-shapeのhint、patching段階、多数決を技術的な真偽にすること。
5. **ablationに留めるもの:** 「短い目的promptがchecklistより新規bugを増やす」という観察は、wp2shellの全手法を維持するというAGENTS.mdの方針と緊張する。既定値は変えず、変更gateでの比較に留める。

### 推奨2: Google Mantisの記録契約（補助参照、段階グラフは採らない）

合わせる時に変えること:

1. **snapshotへの結び付け:** Candidateと検証結果が同じTarget Snapshot digestを持つ時だけ、`runtime-confirmed` / `contradicted`を出す。一致しない、または欠けている時は`incomplete`とする。既存のdigest結び付けを、判定の許可条件として明文化する。
2. **再現の深さ:** Labでの実行を「実際の対象Interface経由（Tier 3相当）」だけが`runtime-confirmed`を出せる、と明示する。PHP関数の直接呼び出しやmock経由の成功は確認として数えない。これは既存の「実際の対象インターフェース」の要件を、判定規則としてtest可能にする変更である。
3. **段階funnelの読み取り専用view:** CloudflareのfunnelとMantisのstatusに倣う。Campaign `inspect`から、`candidates → boundary-admitted → (自動)verified: confirmed / contradicted / incomplete → human-admitted → in-scope`の件数を導く。保存元は既存のResearch RecordとHuman OSで、第二の台帳は作らない。
4. **採らないもの:** 13段階の固定順序、`mantis-history`（過去脆弱性の採掘）、`plan.json`をHarness状態とする計画。

### 参照しないもの

AVDH、Cloudflare VDH、Codex Security plugin、TitanCAの固定段階構成は、「固定段階・固定役割をHarnessに持たせない」と衝突する。ただし次の部分は、段階順序から切り離して個別に評価できる。
- AVDHの「threat modelの人間承認」と「人間がPoCを再現し、通らなければ破棄」。後者は`incomplete`を棄却へ丸めない方針と衝突する。
- Cloudflareの「新規findingを出せないValidator」「200 OK内errorの分類」「shallow run再投入」。

XBOWのcanary検証は、既存のnonce付き`Execution Canary`と同型であり、裏付けとして参照できる。
