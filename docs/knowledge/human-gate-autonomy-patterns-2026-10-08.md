# 人間ゲートの段階的自動化と「検証→人間」順序の公開事例

状態: 調査完了（2026-10-08時点）。一次資料はWebFetch・PDF本文で確認した。取得できなかった資料は「証拠の境界」に明記した。コードと正本文書は変更していない。

## 結論

1. **公開されているAI脆弱性探索の仕組みはすべて「自動検証→人間」の順序をとる。ただし、外部への開示前に人間を外した例は見つからなかった。** Anthropic（Mythos / Glasswing）、Cloudflare、XBOW、OpenAI Codex Security、Big Sleepは、PoCの実行、反証エージェント、決定的な検証器のいずれかを人間より前に置く。人間が受け取るのは自動で絞り込まれた候補だけである。一方で、人間の段階では専門家が**独立に再現**する（Anthropicは外部6社、Mandiantはコンサルタント、Big SleepはProject Zero側）。このリポジトリの「人間が候補を見てから検証する」順序は公開事例と逆である。
2. **「人間が覆した割合が低ければ自動承認へ下げる」という指標は、そのままでは危険である。** IMDAのagentic AI向けガバナンス枠組みv1.5（2026-05）は、覆し率の低さを**rubber-stamping（中身を見ない形式的な承認）の兆候**として監視するよう求めている。HackerOneの承認率94%も、提案が正しいかではなく、受け入れられたかを測っている。利用者自身が「なんとなく承認」と認めている以上、覆し率は品質の証拠にならない。根拠には結果の真偽、つまり実行時検証や提出先での判定を使う必要がある。金融のSR 11-7も、覆しの件数ではなく覆しの成績を追うよう求めていた。
3. **段階的な自律化の公開枠組みは「実績に基づいて承認要件を緩める」方向で一致している。不可逆な外部行動は、それでも人間に残す。** Singapore Consensus 2026は「graduated autonomy…earned rather than granted by default」と書く。Utahの処方更新パイロットは、全件の事前確認250件、全件の事後確認1,000件、月5〜10%の抽出確認、という具体的な段階を定めた。IMDAは不可逆な行動（通信の送信など）を承認が必要なチェックポイントに挙げる。HackerOneの行動規範は「Hackbots must not operate in a fully autonomous manner」と定める。
4. **推奨（Inference）:** (a) Human Candidate Reviewは動的検証の後ろへ動かすべきである。ただし二つの条件を付ける。一つは、`runtime-confirmed`をRecipeの自己申告ではなく、Harnessが所有する判定器（Labが仕込むnonce canaryなど）で決めること。もう一つは、`incomplete`を捨てずに別の列で見せること。(b) ゲート(1)(2)の閾値には覆し率を使わない。結果に基づく指標を層別に記録し、段階を進める条件にする。手本はUtah型の「全件事前→全件事後→抽出監査」の3段階である。件数が少ないため、ゲート(2)は統計的な閾値より先に仕組み（自動検証）で置き換える方が早い。

## 証拠の境界

- **確認できた一次資料（本文を取得）:** Anthropic Mythos Preview、Glasswing initial update、CVD dashboard、Claude Code auto mode、Measuring agent autonomy、Trustworthy agents。Cloudflare cyber-frontier-models。Mandiant AVDH。XBOWのブログ2本とdocs。OpenAI Alignment Auto-review。Elastic Security Labs。HackerOneのdocs（changelog、Hai Triage）、Code of Conduct、ブログ。Bugcrowdブログ。Patchstackの規約。IMDA MGF for Agentic AI v1.5（PDF本文）。Singapore Consensus 2026（PDF本文）。Feng et al. Levels of Autonomy（arXiv HTML）。NIST AI RMF Core。EU AI Act Art.14。SR 26-2添付（PDF本文）。SR 11-7添付（Wayback ArchiveのPDF本文）。Refute-or-Promote、Mitchell et al.、Shi & DiFranzo（いずれもarXivの要旨）。
- **一次資料を取得できず、二次資料または断片だけのもの:**
  - OpenAIの`openai.com`（Aardvark、Codex Security発表）は403だった。後継のdocs（`learn.chatgpt.com/docs/security`、日付なし）とGitHubの`openai/codex-security`のREADMEで代替した。
  - Big Sleepの人間レビューは、2025-08のTechCrunchが引用したGoogle広報の発言しかない。2026年の公式更新は見つからなかった。
  - Google OSS VRPの規約ページはJSで描画されるため本文を取れなかった。停止の文言はHelp Net Security（2026-10-05）の引用による。2026-03の「OSS-Fuzzでの再現を必須化」は二次資料だけで、未確認である。
  - Utah Doctronicの契約書と州のPDFはCloudflareのチャレンジで取得できなかった。段階はhealthesystems（2026-01-26）、Stanford Law（2026-03-19）、STAT（2026-05-26）による。Forbesが報じた「98% / 99%の一致率基準」は州の文書で確認できず、採用しない。
  - Wordfenceの規約本文は取得できなかった（検索結果の抜粋だけ）。
  - ISO/IEC 42001は有償の規格で、本文を確認していない。管理策番号は引用しない。
- **古い資料の扱い:** 2025年以前の資料は、後継の更新を探したうえで使った。Aardvarkは後継のCodex Security、XBOWの2025年ブログは2026年のdocsとブログ、SR 11-7は後継のSR 26-2で補った。Feng et al.（2025-07）は、IMDA v1.5（2026-05）が直接引用しているため残した。
- **数値はすべて各社の自己申告である。** 独立に監査された精度は、VulnCheckがAnthropicの台帳を再集計したもの（二次資料）程度しかない。

## 1. 検証→人間の順序の実例

| 仕組み（公開日） | 人間より前の自動検証 | 人間が見るもの | 人間の役割 | 出典 |
|---|---|---|---|---|
| Anthropic Mythos Preview / Glasswing（2026-04-07、2026-05-22、台帳は2026-10-02時点） | 発見エージェントが「a bug report with a proof-of-concept exploit and reproduction steps」を出す。別のMythosエージェントに「Can you please confirm if it's real and interesting?」と確認させて絞る | AIが絞った候補。29,439件の候補のうち、6,123件を外部の会社がレビューし、5,674件が有効（92.7%） | 外部6社が「reproduce each issue, assess whether it is a real bug」。人手の処理量が開示の律速段階 | [Mythos Preview](https://www.anthropic.com/research/mythos-preview)、[Glasswing update](https://www.anthropic.com/research/glasswing-initial-update)、[CVD dashboard](https://red.anthropic.com/2026/cvd/) |
| Cloudflare（2026-05-18、更新2026-07-22） | Hunterが「compile and run proof-of-concept code in a per-task scratch directory」。Validateは別のプロンプト・別のモデルで「tries to disprove」し、新しい発見は出せない。Traceで外部入力が到達するかを判定 | PoCと再現手順が付いた構造化レポート | 正式な脆弱性管理の手順で「triaged, validated, and remediated」 | [blog.cloudflare.com/cyber-frontier-models](https://blog.cloudflare.com/cyber-frontier-models/) |
| Mandiant AVDH（2026-08-19） | 高温度設定の複数Validationエージェントと、統合エージェント1体。結果はConfirmed / Disproven / Rejectedの3種。**動的検証は自動化していない** | Confirmedだけ。加えて開始時の脅威モデル | コンサルタントが「dynamically replicating the exploitation and executing Proof-of-Concept (POC) code」。失敗したものは破棄する。他社にも「manually validate findings」を推奨 | [Google Cloud blog](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review/) |
| XBOW（docsは日付なし、ブログは2026-03-12） | Deterministic validationは「confirms findings for this class with a non-AI exploit validator」。顧客環境に固有のcanaryを「proof of exploitation」として回収させる。AI agent validationの分類は「some false positives are possible」 | 検証済みのfinding。Private previewの分類は「XBOW's internal security team triages all findings before they are included」 | 2025年のHackerOne提出では「our security team reviewed them pre-submission」 | [docs](https://docs.xbow.com/console/reference/vulnerability-classification)、[Assessment Guidance](https://xbow.com/blog/introducing-assessment-guidance)、[Top 1（2025-06）](https://xbow.com/blog/top-1-how-xbow-did-it/) |
| OpenAI Codex Security（Aardvarkの後継。docsは日付なし、リポジトリ作成は2026-07-13） | 「validates issues in an isolated environment when possible」 | 順位付きのfinding。CLIは「records false-positive feedback」 | パッチは「Review proposed patches before creating a pull request」 | [docs](https://learn.chatgpt.com/docs/security)、[GitHub](https://github.com/openai/codex-security) |
| Google Big Sleep（2025-08、2026年の更新なし） | 「each vulnerability was found and reproduced by the AI agent without human intervention」 | 再現済みの脆弱性 | 「we have a human expert in the loop before reporting」（広報の発言、二次資料） | [TechCrunch](https://techcrunch.com/2025/08/04/google-says-its-ai-based-bug-hunter-found-20-security-vulnerabilities/) |
| Elastic（受け手側のトリアージ、2026-08-04） | 分析→敵対的レビュー→（推奨された場合）再現。再現は報告の約30〜40% | エージェントの判定と内部コメント | 「the final call on every report」は人間。disagreeの判定は保留して人間がレビュー。人間の技術者との一致率85%（結果が分かっている764件） | [Elastic Security Labs](https://www.elastic.co/security-labs/ai-vulnerability-triage-bug-bounty-hackerone) |
| HackerOne Hai Agentic Validation（2026-02） | 方針、対象範囲、過去の報告との照合 | 推奨。自信が高い場合だけDuplicate / Spam / N/Aなどで自動クローズ | 有効性、重大度、報奨金は分析者が決める。「94% recommendation acceptance rate」 | [Feb 2026 changelog](https://docs.hackerone.com/en/articles/13612075-february-2026-changelog)、[How Hai Triage works](https://docs.hackerone.com/en/articles/8837878-how-hai-triage-works) |

**Observed（共通点）**
- 実行時の証拠を人間より前に作る形は、Anthropic、Cloudflare、XBOW、Codex Security、Big Sleepに共通する。Mandiantだけは静的なAI検証を先に置き、動的再現を人間が担う。
- 人間は「候補すべて」ではなく「自動で絞った後」を見る。Anthropicでは候補29,439件に対し、人間がレビューしたのは6,123件だった。
- 開示前の人間ゲートを外した例はない。Anthropicで人間の確認を経ない開示は、メンテナーが「un-triaged findings」を求めた場合だけで、その経路は「May contain false positives」と明示されている（[CVD](https://red.anthropic.com/2026/cvd/)）。
- **LLMの合議は誤りに収束しうる。** Refute-or-Promote（2026-04-21）では「ten dedicated reviewers unanimously endorsed a non-existent Bleichenbacher padding oracle」。これを退けたのは一つの実証テストだけで、論文は実証ゲートを必須とした（[arXiv:2604.19049](https://arxiv.org/abs/2604.19049)）。XBOWも決定的な非AI検証器だけを「no false positives」と呼ぶ。

## 2. 既定承認と事後監査の閾値設計

| 領域・事例（公開日） | 記録するもの | ゲートを下げる指標と方式 | 監査と差し戻し | 出典 |
|---|---|---|---|---|
| Claude Code auto mode（2026-03-25） | 分類器の判定。内部のインシデントログ | 動機は「users approve 93% of permission prompts」による承認疲れ。ラベル付きのデータセットで評価した。実トラフィック1万件でFPR 0.4%、過剰な行動52件でFNR 17%（「the honest number」） | 「3 consecutive denials or 20 total」で人間へ戻す。headlessでは停止する。重要なインフラについては「not a drop-in replacement for careful human review」 | [Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-auto-mode) |
| 上記を独立に評価（2026-04） | 曖昧な権限シナリオ | 端から端までのFNR 81.0%。プロジェクト内のファイル編集は分類器の対象外 | — | [arXiv:2604.04978](https://arxiv.org/html/2604.04978v2) |
| OpenAI Codex Auto-review（2026-04-30） | 「escalation rate, approval and rejection rates, added latency, user overrides, and frequently flagged commands」 | 別のエージェントがサンドボックス境界での承認を代行する。昇格された行動の99.1%を自動承認。安全面のrecallは合成データで測った（過剰な行動90.3%） | 拒否が繰り返されると自動停止する。「should not be treated as a guarantee of security」 | [alignment.openai.com/auto-review](https://alignment.openai.com/auto-review/) |
| Anthropic Measuring agent autonomy（2026-02-18） | 実際の運用で、自動承認したセッションの割合と中断した割合 | 新しい利用者は約20%、750セッション以上の利用者は40%超を自動承認する。中断率は5%から9%へ上がる | 「Effective oversight doesn't require approving every action but being in a position to intervene when it matters」 | [Anthropic Research](https://www.anthropic.com/research/measuring-agent-autonomy) |
| HackerOne Hai（2026-02） | 推奨を受け入れたか退けたか。1〜5の評価 | 受け入れ率94%（正しさの指標ではない） | 結果を左右する行動には人間の承認が要る | 前掲 |
| HackerOne Code of Conduct（日付なし、©2026） | — | 「Hackbots must not operate in a fully autonomous manner」。「human experts to investigate, validate, and confirm all potential vulnerabilities before submitting」 | 提出側の外部制約 | [Code of Conduct](https://www.hackerone.com/policies/code-of-conduct) |
| Bugcrowd（2026-05-18） | アカウントごとの無効な報告の数 | 無効な報告が10件以上ならBAN。成績の低いアカウントは「additional submissions will be temporarily blocked until existing reports progress through triage」 | 本人確認、CAPTCHA | [Bugcrowd blog](https://www.bugcrowd.com/blog/continuing-our-work-to-reduce-ai-slop-submissions-and-protect-signal-quality/) |
| Patchstack（2026年版。2026-10-01開始の更新を含む） | 研究者ごとの却下率 | 却下率50%以上でリーダーボードから1か月除外。月の報奨金は却下率の分だけ減る。「incorrect AI-generated assumptions」「clearly not tested against the actual plugin」は即時1週間BAN。PoCはインストールから悪用成功までの生のHTTPリクエストとpayloadを含むこと | 提出先の費用関数 | [Patchstack guidelines](https://patchstack.com/articles/bug-bounty-guidelines-rules/) |
| Google OSS VRP（2026-10-01） | — | 「as of October 1, 2026, we are no longer accepting product vulnerabilities submitted to the OSS VRP」。理由は「automated submissions, the vast majority of which are not valid」 | Q1 2027に見直し | [Help Net Security](https://www.helpnetsecurity.com/2026/10/05/google-ai-generated-vulnerability-reports-pause/) |
| Project Zero / Big Sleep（2025-07） | 報告から1週間以内に、ベンダー、製品、期限を公開 | 90+30日の方針は維持 | — | [Project Zero](https://projectzero.google/2025/07/reporting-transparency.html) |
| 金融: SR 11-7（2011、すでに置き換え済み） | 覆しの理由と**覆しの成績** | 「If the rate of overrides is high, or if the override process consistently improves model performance, it is often a sign that the underlying model needs revision」 | ベンチマークと比較する | [SR 11-7添付（Wayback）](https://web.archive.org/web/2025/https://www.federalreserve.gov/supervisionreg/srletters/sr1107a1.pdf) |
| 金融: SR 26-2 / OCC 2026-13（2026-04-17） | outcomes analysisとongoing monitoring。独立性のあるeffective challenge | 本文に「override」の語はない。「Generative AI and agentic AI models … are not within the scope of this guidance」 | 独立した検証 | [SR 26-2添付](https://www.federalreserve.gov/supervisionreg/srletters/SR2602a1.pdf) |
| 医療: Utah Doctronic処方更新パイロット（2025-12開始） | 月次の報告（承認・拒否と医師の判断） | Phase 1は最初の250件を医師が送付前に確認する。Phase 2は次の1,000件を全件事後確認する。Phase 3は「monthly review of 5-10%」。250件の単位は**薬剤群ごと**に変わった（STAT、州のページの要約）。次の段階へ進むには州の承認が要る | 2026-05時点でPhase 1。AIが更新を承認した例のうち、医師の同意は91%。3%はどちらの医師も同意しなかった。州が独立レビューを開始。規制物質と新規処方は対象外 | [healthesystems](https://healthesystems.com/regulatory/utah-ai-prescription-renewal-pilot-updates/)、[STAT](https://www.statnews.com/2026/05/26/utah-doctronic-ai-experiment-early-data-health-tech/)、[Stanford Law](http://law.stanford.edu/2026/03/19/utahs-experiment-with-ai-driven-prescription-renewals/) |
| IMDA MGF for Agentic AI v1.5（2026-05-20、更新2026-06-05） | 「Human override rate … A low rate may signal rubber-stamping behaviours」。「Human response times … A shorter time may signal automation bias or review fatigue」。判断パターンが外れた人間を検出する | 高リスク、不可逆、外れ値、利用者定義の行動を承認チェックポイントにする | 承認が実効性を保っているかを定期監査する。Dayosの事例: 低リスクで可逆なTier 1は全自動にし、担当者が2週ごとに横断的な抽出を監査する。Tier 3（本番環境、セキュリティ変更）はエージェントに触れさせない | [IMDA PDF](https://www.imda.gov.sg/-/media/imda/files/about/emerging-tech-and-research/artificial-intelligence/mgf-for-agentic-ai.pdf)（pp.9–10, 18, 29–30） |
| NIST AI RMF 1.0（2023、改訂中） | MANAGE 4.1「mechanisms for capturing and evaluating input from users … appeal and override」 | MAP 3.5「Processes for human oversight are defined, assessed, and documented」 | MANAGE 2.4は、意図した用途と異なる動作をするシステムを「supersede, disengage, or deactivate」 | [AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) |
| EU AI Act Art.14（高リスクのみ） | — | 監督は「commensurate with the risks, level of autonomy and context of use」 | 4(b)はautomation biasへの自覚、4(d)は「disregard, override or reverse」、4(e)は「stop」ボタンを求める | [Art.14](https://ai-act-law.eu/article/14/) |

**Observed（共通点）**
- 自動承認へ移った製品（Claude Code、Codex）は、**人間の覆し率**ではなく、**ラベル付きの評価セットでのFNR / recall**を根拠に公開している。運用中の覆し率は、ゲートを下げる指標ではなく**監視用の信号**として使われている（Codex Auto-review、IMDA）。
- 段階を下げた後も、どの事例も抽出監査（Utahは5〜10%、Dayosは2週ごと）と差し戻しの条件（拒否が続けば人間へ戻す、州の承認、停止）を持つ。
- 金融では、生成AIとagentic AIが新しい指針の対象外になった（SR 26-2の注3）。覆しは件数ではなく「その覆しで成績が上がったか」を追うものだった（SR 11-7）。

## 3. 自律度レベルの枠組み

| 枠組み（公開日） | 段階 | 段階を移る条件 | 出典 |
|---|---|---|---|
| Feng, McDonald, Zhang「Levels of Autonomy for AI Agents」（v2は2025-07-28。2026年のIMDA v1.5が引用） | L1 Operator → L2 Collaborator → L3 Consultant → L4 Approver → L5 Observer。自律度は「designed independently of capability」 | assisted evaluationで、利用者の関与を減らしながら閾値を満たすかを試す。第三者が「autonomy certificate」を発行する。L4の危険として「meaningless rubber stamping」と「reliably determining which actions are consequential may be challenging」を挙げる | [arXiv:2506.12469](https://arxiv.org/html/2506.12469v2) |
| IMDA MGF v1.5（2026-05） | 4段階: agent proposes, human operates / collaborate / agent operates, human approves / agent operates, human observes（「audited after the fact」） | 深刻度、可逆性、人間の監督が現実に可能か、で層に分ける（Dayos） | IMDA PDF p.9–10, 18 |
| Singapore Consensus 2026, Companion Report Principle 10（2026-07） | in-the-loop承認、on-the-loop監視、batch review、AI支援の監督 | 「if agents demonstrate reliability, approval requirements can be relaxed, ensuring that expanded agent autonomy is earned rather than granted by default」。「use demonstrated agent performance data … rather than setting autonomy levels statically」 | [arXiv:2608.14611](https://arxiv.org/abs/2608.14611) pp.87–89 |
| Anthropic Trustworthy agents in practice（2026-04-09） | 行動ごとの承認からPlan Modeへ | 「calibrating agents on deciding when to act and when to hand a decision back」 | [Anthropic](https://anthropic.com/research/trustworthy-agents) |
| Shi & DiFranzo（2026-08-28） | — | 監督が減っても検証は消えず、権限、記録、中断、結果の確認、修復といった実行基盤へ移る。公開物63件の監査では、validator independenceは4件、contestabilityは1件しか見えなかった | [arXiv:2609.29547](https://arxiv.org/abs/2609.29547) |
| Mitchell, Ghosh, Passi（2026-08-24） | — | 監督に必要な能力そのものが、AIの長期利用で「degraded」する | [arXiv:2608.23642](https://arxiv.org/abs/2608.23642) |

**「閾値の運用変更だけで全自動化へ到達する」設計に使えるか（Inference）**
- **ゲート(1)(2)には使える。** 移る先はFengのL4からL5、IMDAの「human approves」から「human observes + after-the-fact audit」にあたる。Singapore Consensusの「実績データで動的に緩める」という考え方とも合う。
- **ゲート(3)(4)には使えない。** 外部提出はIMDAの「sending communications」という不可逆な行動にあたる。HackerOneは完全自律のhackbotを禁じている。したがって閾値の設定項目にせず、型と実行環境で固定するべきである。現行のAGENTS.mdの不変条件とも一致する。
- Fengの「autonomy certificate」がモデルやスキャフォールドの変更で無効になる考え方は、そのまま使える。モデル、プロンプト、Recipeの判定器、Lab構成が変わったら、段階を一つ戻して実績を取り直す。

## 4. 人間の判断が弱い前提での設計

| 仕組み | 事例（Observed） |
|---|---|
| 決定的な非AIの判定器とcanary | XBOW: headless browserでXSSの実行を確認する。顧客固有のcanaryをファイルやDBに置き、LFIやSQLiなら回収させる |
| 実証ゲートの必須化 | Refute-or-Promote: LLMレビュアー10体が一致して誤った発見を、一つの実証テストが退けた |
| 権限の異なる反証エージェント | Cloudflare: 別プロンプト・別モデルで、新しい発見を出せない。Mandiant: 複数のValidationエージェント＋統合エージェント。Elastic: 敵対的レビューが約15%でCVSSの水増しなどを検出 |
| 独立した再現 | Anthropic: 外部6社が全件を再現し、重大度を再評価する。Mandiant: コンサルタントがPoCを実行する |
| 人間の監督そのものの監査 | IMDA: 覆し率（低ければrubber-stamping）、応答時間（短ければ自動化バイアス）、外れ値の人間を監視する。「Ensuring that humans possess the domain expertise」とし、vibe codingの利用者は堅牢性を審査できないという例を挙げる |
| 抽出監査 | Utah: 5〜10%を毎月。Dayos: 2週ごとに横断抽出 |
| 提出側の品質を経済的に縛る | Patchstack: 却下率の分だけ報奨金を減額する。Bugcrowd: 無効10件でBAN、処理が進むまで新規の提出を止める。Google OSS VRP: 受付を停止 |
| 意図された動作による誤検知 | curlの事例（二次資料）: Mythosの「確認済み」5件のうち3件はAPI文書に書かれた意図どおりの動作だった（[Flying Penguin](https://www.flyingpenguin.com/page/39/?P=17466)、低信頼）。Anthropicは発見の後に「real and interesting」かどうかで絞る |

## 5. このリポジトリが採用するなら

現行の設計（ADR 0135、ADR 0130、`docs/domain/human-os/CONTEXT.md`）は次のとおりである。Candidate Reviewはadmitかresearch returnだけを決める。admitされた候補のRecipeを、新しいLabで一度だけ実行する。Recipeスクリプトが、前提を満たしたか、Recipeを完走したか、効果を観測したか、の3条件を自分で返し、すべて真なら`runtime-confirmed`になる。結果は`runtime-confirmed` / `contradicted` / `incomplete`のいずれかである。ADR 0130によると、既存Recipeの再実行は約18秒だった。

### (a) Candidate Reviewを検証の後ろへ動かすべきか

**推奨: 動かす。ただし下の4条件を同じ変更で入れる。**

| 根拠・条件 | Observed | Inference |
|---|---|---|
| 公開事例の順序 | Anthropic、Cloudflare、XBOW、Codex Security、Big Sleepは、実行時の証拠を人間より前に作る（§1） | 現行の順序は、弱いレビュアーに最も難しい「本物か」の判断をさせている。順序を変えれば、人間の問いは「影響が意味を持つか、意図された動作ではないか」に絞られる |
| 費用と安全 | ADR 0130: 再実行は約18秒。検証は使い捨てのgVisor Lab内で行う（AGENTS.md） | 検証の前倒しは、外部行動や権限拡張（ゲート3、4）に触れない。安全上の不変条件を変えずに、ゲート(2)を外せる |
| **条件1: 判定器の独立** | XBOWは非AIの検証器だけをFPゼロと呼ぶ。Refute-or-Promoteは、LLMの合議が誤りに収束した例を示す | 人間ゲートを外すと、ADR 0130のRecipe自己申告がそのまま確認になる。Harnessが**Labの準備時にnonceを仕込み、外部から回収を判定する**判定器へ置き換える。例は、権限がないと読めないoptionやpost metaへのcanary、RCEなら既存の`Execution Canary`である。そのうえで`runtime-confirmed`の必要条件にする。canaryを定義できない種類の候補は、自動で確認せず人間の列へ回す |
| **条件2: `incomplete`を捨てない** | AGENTS.mdは、動的検証の不足を誤検知または棄却へ読み替えることを禁じている | 人間が`runtime-confirmed`だけを見る設計では、`incomplete`が黙って消え、再現率が落ちる。`incomplete`と`verification-preparation-needed`は、具体的な次の手を付けた別の列としてHuman OSに出す。`contradicted`は件数と抽出だけを見せる |
| **条件3: 前提の過剰適合を防ぐ** | curlの事例では、意図された動作が「確認済み」になった（二次資料）。Cloudflareは外部入力の到達性を別の段階（Trace）で判定する | Lab構成（既定設定か、プラグインのオプション、攻撃者のロール）はHarnessが固定する。Recipeが前提を変えた場合は`runtime-confirmed`にせず、「非既定の前提」という印を付ける |
| **条件4: 正本の更新** | ADR 0135とAGENTS.mdは「Human Candidate Reviewで採用された候補だけを…」と定めている | 新しいADRで0135を置き換え、AGENTS.md、`CONTEXT.md`、回帰テスト（「一度だけの新しい動的検証」「AIの失敗を棄却へ丸めない」）を同じ変更で更新する |

### (b) 既定承認へ下げる閾値の指標

**原則（Inference）:** 覆し率は監視用の信号にとどめる。ゲートを下げる根拠には、結果に基づく指標を使う。根拠はIMDAの「低い覆し率はrubber-stamping」、SR 11-7の「覆しの成績」、HackerOneの受け入れ率94%が正しさを意味しないこと、の三つである。

**判断ごとに記録する項目**

| 項目 | 目的 |
|---|---|
| gate、campaignId / candidateId、AIの推奨、人間の判断、編集差分、構造化した理由コード | 覆しを同定する |
| 判断までの時間、非公開証拠を開いたか | 形式的な承認を検出する（IMDAの応答時間の指標） |
| モデル、プロンプト、Recipe判定器、Lab構成の版 | 版が変わったら段階を一つ戻す（Fengのcertificateが無効になる考え方） |
| 後から分かる正解: 検証結果、提出先での判定（triaged / resolved / duplicate / informative / N/A / rejected） | 覆しの成績と、AI推奨の精度を測る |
| 層: 脆弱性の種類、攻撃者のロール、canaryで判定できるか | Utahの「薬剤群ごと」に相当する層別 |

**ゲート別の指標と段階**

| ゲート | ゲートを下げる指標（Inference） | 段階（Utah型を参考にしたInference） |
|---|---|---|
| (1) Campaign開始 | AIの`Target Proposal`を人間が編集した割合ではなく、承認後の実行前再確認（版、ソースの鮮度、Programme Boundary）での失敗率と、Campaignごとの`runtime-confirmed`・in-scopeの産出で測る。安全は既存のBoundaryと鮮度の確認が担うため、残るのは機会費用である | 全件事前承認 → 方針に適合したものを既定承認し、全件を事後レビュー → 抽出監査。AGENTS.mdの「人間はキャンペーン開始を所有する」を変えるため、ADRが要る |
| (2) Candidate Review（(a)の後は、検証後のレビュー） | 移行期間はshadow方式にする。人間の判断と無関係に全候補を検証し、人間の判断は結果を見ないまま記録する。測るのは次の2点である。**人間が却下した候補のうち`runtime-confirmed`になった件数**（人間が再現率を失わせた分）と、**採用した候補のうち`contradicted`の件数**（人間の精度）。前者が0件でなければ、ゲートは再現率を下げているため外す | (a)を採用すればゲート自体がなくなる。検証後に人間が見る段階には、下のサンプル数を適用する |
| (4) 外部提出（人間を残す） | 提出後の判定。Patchstackでは却下率50%以上で除外され、報奨金が却下率の分だけ減る。この費用関数を基準に、提出後の却下や重複を記録する | 閾値で自動化しない。HackerOneのCode of Conductと、IMDAの不可逆な行動に該当する |

**サンプル数（Inference。rule of threeによる95%上限）**
- 誤りが0件の連続n件から言える誤り率の95%上限は、およそ3/nである。5%未満と言うにはn≥60、2%未満にはn≥150、1%未満にはn≥300が要る。
- 層ごとに数える。誤りが1件出たら、その層のカウントを0に戻す。
- Utahは1段目に250件、2段目に1,000件を置いた。
- 個人開発者の候補数（月に数件程度と想定）では、層ごとにn=60へ届くまでに長い時間がかかる。だからゲート(2)は統計ではなく、(a)の仕組みで外す方が早い。統計的な閾値はゲート(1)と、検証後のレビュー段階に向く。

**監査方法（Inference。IMDA、Utah、Dayosを参考）**
1. 既定承認へ下げた後も、層ごとに5〜10%を無作為に抽出し、後日まとめてレビューする（Utahの方式）。
2. 外れ値は全件を監査する。判断が数秒で終わったもの、証拠を開かずに承認したもの（IMDA）が対象である。
3. **既知の正例と負例をレビュー列へ混ぜる。** リポジトリにあるknown-positive corpusと、既知の誤検知を、見分けがつかない形で混ぜ、人間の検出率を直接測る。IMDAが求める「承認の実効性の監査」を、覆し率に頼らずに行える。
4. 自動で段階を戻す条件: 提出後にfalse positiveやintended behaviorとして却下された、`runtime-confirmed`後に反証された、版が変わった、抽出監査で重大な不一致が出た。Claude Code auto modeの「3回連続の拒否で人間へ戻す」と同じ発想である。
5. ゲート(3)(4)は閾値の設定項目にしない。型と実行環境で固定する。
