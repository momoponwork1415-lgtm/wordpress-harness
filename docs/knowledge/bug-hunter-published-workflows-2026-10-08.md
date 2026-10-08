# 調査資料: AIを使う脆弱性研究者・小チームの公開ワークフローと実績

状態: 一次資料に基づく調査（2026-10-08取得）。既存の`docs/knowledge/`内の`high-volume-wordpress-researcher-workflows-2026-09-13.md`、`patchstack-vs-wordfence-rewards-2026-09-13.md`、`argus-wp2shell-research-method.md`、`reference-harness-observability.md`、`cheap-model-prospective-vulnerability-discovery-2026-09-16.md`、`wp2shell-current-research-gap.md`に書かれている事実（Rafie / darooの実績、Wordfence 2026年3月実績、Patchstack/Wordfenceの報奨規則、wp2shellのprompt、Argusの10動詞、Anthropic reference harness、Cloudflare、Codex Security、AISLE、Unit 42等）は繰り返さない。

## 結論

1. **実績のある公開ワークフローは、ほぼすべて「安く広い候補生成 → 発見役とは別の検証 → 人間が検証済みのものだけを見る」の三層である。** Anthropic Mythos Previewの足場は、隔離コンテナ内でエージェントが対象を**実行して**仮説を確認し、別の最終エージェントが「本物で重要か」を判定し、その後に専門の人間が全件を再現してから開示する（[Mythos Preview, 2026-04-07](https://www.anthropic.com/research/mythos-preview)）。XBOWは「発見したエージェントと確認する仕組みは決して同じではない」と明言する（[XBOW, 2026-03-02](https://xbow.com/blog/we-ran-1060-autonomous-attacks)）。人間は検証前の候補の採否ではなく、**検証済み候補の再現・重大度の再評価・開示のペース配分**を担う。
2. **2026年の公開資料は一致して、ボトルネックは発見ではなく検証だと述べる。** Glasswingの初回報告では、評価済み1,752件中1,587件（90.6%）が真陽性だったが、高・重大と確認されたのは1,094件（62.4%）で、開示530件のうち修正済みは75件だった（[Glasswing update, 2026-05-22](https://www.anthropic.com/research/glasswing-initial-update)）。Carliniは未検証のクラッシュを数百件抱えたまま報告しない（[講演の記事, 2026-04-03](https://mtlynch.io/claude-code-found-linux-vulnerability/)）。
3. **WordPressに近い実績者（Wordfence PRISM / Argus、Ananda Dhakal、wp2shell）は、内部手順をほとんど公開していない。** PRISMは2026-07-23時点で直近30日に88件、通算202件を公開した。人間とPRISMの提出はAIトリアージツールEclipseが処理する（[Wordfence, 2026-07-23（転載）](https://malware.news/t/a-new-threat-landscape-meets-a-new-kind-of-defender/124213)）。ただし、PRISMの構成、対象選定、誤検知率は非公開である。WordPress領域で「確立された設計」としてそのまま写せる公開手順は存在しない。
4. **このHarnessとの最大の差は、自動の実行時検証が人間レビューより前にあるかどうかである。** 実績ある公開ワークフローはどれも、探索エージェントが隔離環境で対象を実行するか（Anthropic、Mythos、Firefox）、決定論的な検証器を通してから人間に渡す（XBOW）。一方このHarnessの探索は読み取り専用のソースだけを使い、`Human Candidate Review`が実行時検証より前にある。人間が未検証の候補を採否する構成は、調べた公開事例にはない。
5. **推奨（詳細は末尾）:** 参照するなら **(A) Anthropic Mythos Preview足場 + Glasswing開示パイプライン** を全体構成の、**(B) XBOWの発見と検証の分離（観測したロールの振る舞いを基準にしたIDOR検証を含む）** を権限系バグの検証の参照にする。

## 証拠の境界

- **Observed** は本人・公式組織の記事、公式プログラムの月次報告、公式プロフィールに書かれた内容である。**Inference** は私の判断であり、本文では「推論」と明記する。
- **公開日** は各行に明記した。2025年の資料は、2026年の後継資料が同じ著者・組織から出ていないかを確認し、ある場合は後継を優先した（Heelan、XBOW）。
- **wordfence.comはWebFetchで本文を取得できなかった**（空応答、curlはHTTP 202）。WordfenceのブログはMalware Newsの全文転載から引用し、元URLを併記した。転載の内容はWordfenceの原文として扱うが、表やグラフの画像は取得できていない。
- **二次資料** は一次資料が取得できない時だけ使い、行内で「二次」と明記した。CarliniのLinuxカーネル事例は講演動画（[YouTube](https://www.youtube.com/watch?v=1sd26pWhfmg)）を視聴できず、[mtlynch.ioの記事（2026-04-03）](https://mtlynch.io/claude-code-found-linux-vulnerability/)に依拠する。
- 件数はすべて**本人・組織の自己申告**である。採択済み件数から精度、再現率、hit rateは導けない（既存資料と同じ立場）。
- 調べたが今回の主表から外したもの:
  - Google Big Sleep: 2026年の新しい発見報告を一次資料で確認できなかった。直近の公式発表はCodeMenderのプレビュー公開（2026-07-21）である。
  - "Hunting CVEs in WordPress Plugins using Claude + Semgrep"（infosecwriteups、2026-05-17表記）: 本文が403で取得できず、検索の抜粋しか読めていない。参考欄に信頼度低として残す。

## 事例別の観測事実

### 表1: 公開ワークフロー（新しい順ではなく、参照価値の高い順）

| 事例 / 公開日 | 対象と選定基準 | モデル・足場・探索量 | 候補 → 確認の歩留まり | 人間の判断点 |
| --- | --- | --- | --- | --- |
| **Anthropic Mythos Preview**（[2026-04-07](https://www.anthropic.com/research/mythos-preview)） | OSSとクローズドソース。各プロジェクトでClaudeがファイルごとに「バグがありそうか」を1〜5で順位付けし、高い順に着手する | 隔離・ネット遮断コンテナでClaude Code + Mythos Previewを動かす。promptは短い（"Please find a security vulnerability in this program."）。多数のエージェントを並列にし、**各エージェントへ別ファイルを割り当てて重複を減らす**。OpenBSDは1,000回の実行で合計$20,000未満（主要バグを見つけた1回は$50未満）、FFmpegは数百回で約$10,000 | エージェントはコードを読んで仮説を立て、**プロジェクトを実行して**確認・棄却する。出力は「バグなし」またはPoC付き報告。最後に別のMythosエージェントが「本物で、かつ重要か」を判定する。人手で確認した198件では、重大度の評価が完全一致89%、1段階以内98% | 最上位の重大度の報告は専門の人間トリアージへ回す。外部契約者が保守者へ送る前に全件を手で検証する。ロジックバグはクラッシュのような判定基準がなく、自動探索と検証が難しいと明記している |
| **Anthropic Project Glasswing 初回報告**（[2026-05-22](https://www.anthropic.com/research/glasswing-initial-update)） | 1,000超のOSSプロジェクト、約50の提携組織 | 発見の総数は23,019件、高・重大の推定は6,202件 | 評価1,752件、真陽性1,587件（90.6%）、高・重大の確認1,094件（62.4%）。開示530件中、修正済み75件 | Anthropicまたは6社の独立セキュリティ企業が**再現 → 重大度の再評価 → 既に修正済みかの確認 → 詳細報告**の順に処理する。未検証での直接開示は保守者が求めた場合だけ。保守者の求めに応じて開示ペースを落とした |
| **Anthropic Frontier Red Team: LLM-discovered 0-days**（[2026-02-05](https://www.anthropic.com/research/zero-days)） | 「どこでも動く」OSSと、十分にfuzzingされたコードベース | Opus 4.6。最新版、標準ユーティリティ、デバッガー、fuzzerを入れたVM。特別な指示もカスタム足場もない | 検証しやすいメモリ破壊に絞った。Claude自身がクラッシュを批評・重複除去・再優先付けした。高重大度500件超を「検証済み」とする | 初回分はAnthropicの研究者が検証し、パッチを手で書いた。件数が増えると外部の研究者を加えた |
| **Anthropic × Mozilla Firefox**（[Anthropic 2026-03-06](https://www.anthropic.com/news/mozilla-firefox-security)、[Mozilla 2026-03-06](https://blog.mozilla.org/en/firefox/hardening-firefox-anthropic-red-team/)） | 単独で解析しやすいJSエンジンから始め、約6,000のC++ファイルへ広げた。先に過去のCVEを再現できるか試した | Opus 4.6、2週間。モデルが自分の出力を確かめられる「task verifier」を使った | 112件の固有報告からCVEは22件（19.6%）、うちHighが14件。他に90件のバグがあり、多くは修正済み。エクスプロイト化は数百回の試行・約$4,000で成功2件 | 初件は別VMで研究者1名が検証し、さらに2名が確認した。各報告に**最小テストケース、PoC、パッチ案**を付けた。Mozillaは「最小テストケースで素早く検証・再現できた」ことを信頼の理由に挙げた |
| **Nicholas Carlini（Anthropic）, [un]prompted講演**（記事 [2026-04-03](https://mtlynch.io/claude-code-found-linux-vulnerability/)、二次） | Linuxカーネルの全ソースファイル | 全ファイルを順に回るスクリプトで、ファイルごとにClaude Codeを1回起動する（ファイル名をヒントにして同じバグへの収束を防ぐ）。CTFの設定で依頼する。Opus 4.6。Opus 4.1 / Sonnet 4.5では一部しか見つからなかった | 潜在的なバグは数百件。報告済みまたは修正済みとして記事が確認できたのは5件 | 人間が検証してから報告する。「slopを送りたくない」として、未検証のクラッシュ数百件を報告していない |
| **XBOW**（[2025-06-24](https://xbow.com/blog/top-1-how-xbow-did-it/)、後継 [2026-03-02](https://xbow.com/blog/we-ran-1060-autonomous-attacks)、[2026-05-28](https://xbow.com/blog/xbow-finds-idors-high-accuracy-ambiguous-context)） | HackerOneのscope・policyをLLMと人手で読み取る。WAF、HTTP status、redirect、認証フォーム、技術スタックなどでtargetを採点する。SimHashと画面のimagehashで似た資産をまとめる | 自律型ブラックボックス（オープンソースではソースを渡すwhite-box）。2026年版では、各操作を実行前に安全確認し、確認できない操作は実行しない | 約1,060件を提出し、resolved 130、triaged 303、duplicate 208、informative 209、N/A 36（2025-06時点）。直近90日の重大度はCritical 54 / High 242 / Medium 524 / Low 65。2026年版は「誤検知ゼロ」と自称する。検証器はLLMまたは専用のプログラムで、XSSはheadless browserで実行を確かめる。IDORは、各ロールで普通に操作した「学習フェーズ」の観測と照らして判定する | 人間は提出前にHackerOneの規約順守を確認するだけで、発見・攻撃には関与しない（2026年版の記述）。[GPT-5の記事](https://xbow.com/blog/gpt-5)（日付未確認）では、XSS検証器が誤って有効と判定した例を認めている |
| **Sean Heelan**（[2025-05-22](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/)、後継 [2026-01-18](https://sean.heelan.io/2026/01/18/on-the-coming-industrialisation-of-exploit-generation-with-llms/)） | ksmbd。本人が過去に見つけたCVEを、モデルの能力を測る基準に使った | o3 API。ツールも足場も使わない。人間が文脈を切り出した（小: 約3.3k LoC / 約27k tokens、大: 約12k LoC / 約100k tokens）。promptにはksmbdの構造と**脅威モデルの説明**、「誤検知より何も報告しない方を選べ」という指示を入れた。各設定で100回実行し、大きい文脈の100回で約$116 | 小さい文脈では既知バグを8/100回で発見し、誤検知28、見逃し66。大きい文脈では1/100回まで落ち、信号対雑音比は約1:50。新規のCVE-2025-37899はこの出力から見つかった | 文脈の切り出し、真陽性の判定、修正案の不足の判断を人間が行う。2026年版では、工業化できる条件として「人手なしの探索」と「正確・高速で人手の要らない検証」を挙げる。QuickJSの未知バグはOpus 4.5の自作エージェントが発見した（1回30M tokensで約$30） |
| **Wordfence PRISM / Eclipse / Argus**（PRISM・Eclipse: [2026-07-23（転載）](https://malware.news/t/a-new-threat-landscape-meets-a-new-kind-of-defender/124213)、元URL `wordfence.com/blog/2026/07/a-new-threat-landscape-meets-a-new-kind-of-defender/`。Argus Events Calendar: [2026-09（転載 2026-09-14）](https://malware.news/t/wordfence-argus-identifies-two-critical-unauthenticated-vulnerability-chains-leading-to-remote-code-execution-in-the-events-calendar-plugin/125571)） | WordPressのplugin / theme。PRISMの選定基準は非公開 | PRISMは2026年4月頃に開始し、直近30日で88件（1日平均2.8件）、通算202件。「purely autonomously」と書く。Chloe Chamberlandが構想・監督した。Argusは600K install超のThe Events Calendarで、独立した未認証RCEチェーンを2本（8/21、8/22）見つけた | Eclipseは人間の研究者とPRISMの両方の提出をトリアージし、「脆弱性パイプラインを大きく加速した」とする。精度は非公開 | Argusの2本目について、Threat Intelligenceチームが「報告を検証しPoCを確認した」後にベンダーへ連絡した。PRISMが見つけたBurst Statisticsの認証回避は月次報告で提出者「Wordfence PRISM」、報奨N/Aとして載る。記事は「研究者もoperatorになりつつあり、より効果的なharnessやpromptを作るだろう」と書く |
| **Ananda Dhakal**（[更新日 2026-08-23](https://dhakal-ananda.com.np/misc/more-criticals-less-dopamine/)） | 対象選定は記述なし | ClaudeとCodex。新しい版が出るたびに切り替える。Codexをバックグラウンドで動かす | 件数、誤検知率、費用の記述はない | 「モデルにPoCを出させ、**外部から**試して確認する」「cheatしていないか確認するだけ」「何か月も手作業の深いコードレビューをしていない」「ハッキングは今や"どこを・何を"の問題」 |
| **Bronxi**（Bugcrowd寄稿、[2026-06-01](https://www.bugcrowd.com/blog/what-i-learned-building-ai-agents-for-bug-bounty-hunting/)） | Googleにindexされた文書からの情報漏えい | CrewAIの4エージェント（URL探索、文書取得、機微情報の判定、報告作成） | 「数十件単位」で検出したが、大半が誤検知だった | 比較の結果、エージェントに残したのは報告書作成だけで、他はBashスクリプトに戻した。「AIは既に機能する方法論の増幅器であって、方法論の代わりではない」「自分で検証していない報告は、トリアージ担当に検証を頼んでいるのと同じ」 |
| **Joshua Rogers**（[2025-10-19](https://joshua.hu/retrospective-zeropath-ai-sast-source-code-security-scanners-vulnerability)、本人の2026年の後継記事は見つからず） | curl（AI報告を公に拒んでいるプロジェクトをあえて選んだ） | ZeroPathを主に使い、DryRun、Ghost等のAI SASTも比較した | 修正済みは約150件（記事時点）。curl保守者の評価では、ZeroPath所見の誤検知は約20% | 報告はEvidenceとRationaleの節を持つ形式。古い事例なので参考に留める |

### 表2: wp2shell（Searchlight Cyber）の後継の有無

既存資料がprompt、約10時間、約$25、人間による途中確認まで記録済みである。今回の新しい事実は二つだけ:

- Searchlight Cyberの研究一覧（2026-10-08取得）では、wp2shell関連の2本（[2026-07-17 advisory](https://www.slcyber.io/research/wp2shell-pre-authentication-rce-in-wordpress-core)、[2026-07-20 手法記事](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6)）の後に、AIによるWordPress研究の続報はない（[research index](https://www.slcyber.io/research/)）。
- WordPress 7.0.3の12件の修正には、pwn.ai（自律型pentest）とAnthropicの名前が発見者として並ぶ。PatchstackはWordPress CoreへのHackerOne報告が7月に450件に達したと書き、高性能モデルの普及と「一致する」とした（[Patchstack, 2026-08-06](https://patchstack.com/articles/wordpress-7-0-3-released-12-vulnerabilities-found-and-fixed/)）。

## 公開実績の規模

### Wordfence月次報告（2026年4〜6月）

既存資料は2026年3月だけを集計しているため、その後3か月分を追加する。月次報告は対象月の約2〜3か月後に公開される（6月分の元URLは`/blog/2026/09/`）。

| 月 / 出典 | 提出 | in-scope（比率） | OOS | rejected | duplicate | 報奨総額 | 平均報奨 | 最高報奨 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-04（[転載](https://malware.news/t/wordfence-bug-bounty-program-monthly-report-april-2026/124416)、元 `/blog/2026/07/…-april-2026/`） | 1,288 | 180（14.0%） | 165 | 572 | 371 | $37,054 | $205.86 | $4,914 |
| 2026-05（[転載](https://malware.news/t/wordfence-bug-bounty-program-monthly-report-may-2026/125563)、元 `/blog/2026/09/…-may-2026/`） | 1,095 | 149（13.6%） | 86 | 526 | 334 | $34,454 | $231.23 | $6,436 |
| 2026-06（[転載](https://malware.news/t/wordfence-bug-bounty-program-monthly-report-june-2026/125903)、元 `/blog/2026/09/…-june-2026/`） | 1,066 | 185（17.4%） | 1 | 578 | 302 | $42,553 | $230.02 | $5,200 |

研究者別（in-scope件数 / 獲得額。上位5人の表に載った場合だけ記載）:

| 研究者 | 2026-04 | 2026-05 | 2026-06 | 公開されたAI利用の記述 |
| --- | --- | --- | --- | --- |
| Rafie Muhammad | 14件 / $3,724 | — | 8件 / $1,665 | 既存資料（LinkedInでClaude利用に言及） |
| daroo | — | 6件 / $8,297（平均$1,382.83） | 9件 / $4,858 | 公開手法なし（既存資料） |
| h0xilo | 6件 / $6,966 | 6件 / $2,409 | — | 確認できず |
| Jonah Burgess (CryptoCat) | — | 11件 / $1,693 | — | 確認できず（下記） |
| lhking | 9件 / $3,323 | 収入のみ2件 / $1,503 | — | 確認できず |
| CHOIGYEONGMIN | — | 収入のみ2件 / $6,761 | 8件（平均$21.63） | 確認できず |
| Wordfence PRISM | — | Burst Statisticsを提出（報奨N/A） | 同左 | 組織のAIエージェント |

Jonah Burgess (CryptoCat)は、本人ブログに2026年のWordPress plugin CVE分析を21本公開している。12本がXSS、3本がSQLi、残りはアクセス制御、ownership、情報漏えい、ファイル読み取り等である。ただし一覧ページに日付がなく、**AIワークフローの記述も見当たらない**（[cryptocat.me/blog](https://cryptocat.me/blog/)）。上位の人間研究者で、AIを使った手順を本人が公開している例は、今回の調査でも見つからなかった。

### Patchstack

- 2025年のWordPress脆弱性は11,334件で、high severityは1,966件（17%）。Premium / freemium componentの有効報告は1,983件で全体の29%、Zero Day programはPremiumで33件、無料版で12件の高重大度を見つけた。「AI生成の"slop"報告が2025年に大幅に増えた」とする（[State of WordPress Security in 2026, 2026-02-25更新](https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/)）。
- 2026-06-01からの変更: Contributor roleを対象外にし、受理する種類と条件を列挙した。level報奨と無作為抽選報奨を廃止し、月間poolを上位5人に限定した。誤ったAI前提や未検証の報告は即時1週間の停止とした。挙げられた典型的な偽の手掛かりは、画像しか受け付けない「任意upload」、frontendに出ないnonce、通常のサーバーにない前提条件、遠隔で得られない秘密値である。1件の脆弱性に20件超のduplicateが来た例もある（[Dave Jong, 2026-05-29](https://patchstack.com/articles/the-future-of-the-patchstack-bug-bounty-program/)）。
- **後継の状態:** 既存資料が記録した2026-09-01版rulesは、月間AXP寄与率で$10,000の最低poolを配分すると定める。今日（2026-10-08）のleaderboardは10月分が空で、「TOP20+2 monthly pool」「VDP pluginは+15% XP、Zeroday報奨は最大$33,000」と表示している（[leaderboard](https://patchstack.com/database/leaderboard/)）。5月の「上位5人」は後の改定で置き換えられた可能性があるが、公開ページ同士の不整合は残る。

### 組織・チームの規模（表1の再掲を除く要約）

| 主体 | 期間 | 確認済み件数 | 重大度 |
| --- | --- | --- | --- |
| Anthropic（Opus 4.6, OSS） | 〜2026-02 | 高重大度500件超（自己検証） | High以上のみ集計 |
| Anthropic × Mozilla | 2026-01の2週間 | CVE 22件 | High 14 / Moderate 7 / Low 1（[Mozilla](https://blog.mozilla.org/en/firefox/hardening-firefox-anthropic-red-team/)） |
| Glasswing（Mythos Preview + 提携組織） | 2026-04〜05 | 真陽性1,587件（評価済み分） | 高・重大1,094件 |
| XBOW | 2025年の約90日〜2026-03（「過去2年」） | resolved 130 / triaged 303（2025-06） | Critical 54 / High 242 / Medium 524 / Low 65（直近90日） |
| Wordfence PRISM | 2026-04〜07 | 202件（2026-07-23） | 非公開 |

## 共通パターンと差異

### 表3: 段階別比較

| 段階 | 共通点 | 差異 |
| --- | --- | --- |
| 対象選定 | 機械的に広く取る。全ファイル（Carlini）、ファイルの事前順位付け（Mythos）、target採点と重複除去（XBOW） | 人間が狭く選ぶ例もある: Heelanは1モジュール、Firefoxはまず解析しやすいJSエンジン。curlはあえて「AI報告を嫌うプロジェクト」を選んだ |
| 探索 | 短いprompt + 強いモデル + 並列化。並列の単位は**ファイルまたは入口ごとの分担**で、重複を減らす目的で使う | Heelanは人手で文脈を切り出してツールなしで100回実行。Anthropicは対象の実行、デバッガー、fuzzerまで許す。XBOWはブラックボックスで実際のアプリに対して操作する |
| 候補の絞り込み | 発見役とは別の役が判定する（Mythosの最終エージェント、XBOWの検証器、Claudeによる批評・重複除去） | 判定基準: メモリ破壊はASanという決定論的な判定。XSSはブラウザでの実行。IDORは観測したロールの振る舞い（XBOW）。ロジックバグは「判定基準がなく難しい」（Mythos） |
| 検証 | **人間に届く前に、実行による確認が自動で済んでいる**（Mythos、Firefox、XBOW、Anthropic 0-days）。人間は再現と重大度の再評価を行う | 自動検証がない例（Heelan、Dhakal、Bronxi）では人間が直接検証する。Heelanは信号対雑音比1:50を問題視し、検証器が必要だと書いている |
| 提出 | 最小テストケース、PoC、再現手順。保守者が素早く再現できる形にする | Firefoxはパッチ案も付けた。Glasswingは報告前に既存の修正を確認し、保守者の要望で開示ペースを調整した |

### (a) 探索前に脅威モデルや攻撃面を書く工程

- **Observed:** Heelanはpromptにksmbdの構造と脅威モデルの説明を入れた。XBOWはIDORについて、攻撃前に各ロールの正常な振る舞いを観測する「学習フェーズ」を置く。Mythosは文章の脅威モデルを書かず、ファイル単位で「バグがありそうか」を順位付けするだけである。Anthropic 0-daysとCarliniは特別な指示なしで、CTFの設定を与えるだけだった。
- **推論:** 実績ある自律足場は、文章の脅威モデルより**ファイル単位の網羅と事前の順位付け**に頼る。脅威モデルが効いているのは、正常な振る舞いの基準が要る権限系バグ（XBOWのIDOR）と、人間が文脈を絞る研究（Heelan）である。

### (b) 同一対象の過去脆弱性の参照

- **Observed:** AnthropicのGhostScript事例では、fuzzingと手動解析が失敗した後、Claudeが**commit履歴のセキュリティ修正**を読み、同じ関数の別の呼び出し元に同じ確認が欠けていることを見つけた（[zero-days](https://www.anthropic.com/research/zero-days)）。Firefoxでは、探索の前に過去のCVEを再現できるかを試した。Heelanは自分の既知CVEをモデル選定の基準に使った。XBOWのApache Druid事例は、古いCVEを実際のアプリへ結び付けて新しい0-dayに至った（検索結果の要約、二次）。一方wp2shellは、Git履歴を消してモデルが答えを見られないようにした。
- **推論:** 過去の脆弱性は「答え」ではなく、**能力の較正**と**亜種分析の出発点**として広く使われている。履歴を消すのは、評価の公正さ（oracle-free）を優先するときだけである。

### (c) 人間レビュー前の検証の自動化

- **Observed:** Mythos（ASan + 最終検証エージェント → 人間）、XBOW（決定論的な検証 → 人間は規約確認のみ）、Firefox（task verifier → 研究者の検証）、Wordfence（PRISMの出力をEclipseがトリアージ → チームがPoCを確認）。自動化していないのはHeelan、Dhakal、Bronxiで、いずれも人手の検証量が上限になると本人が書いている。
- **推論:** 実績の規模（数百〜数千件）は、ほぼ自動検証の有無で分かれる。

### (d) 偽の手掛かりの捨て方

- **Observed:** ファイル単位の分担で同じバグへの収束を避ける（Mythos、Carlini）。別エージェントが「本物で、かつ重要か」を判定する（Mythos）。似た資産をハッシュでまとめる（XBOW）。promptで「誤検知より何も報告しない方を選べ」と指示する（Heelan。本人は効果を未評価と明記）。未検証のものは送らずに積み残す（Carlini）。既存の修正を確認する（Glasswing）。
- **WordPress固有の偽陽性（Patchstackの棄却例）:** 画像しか受け付けないupload、frontendに出ないnonce、通常構成にない前提条件、遠隔で得られない秘密値。いずれも「実際のpluginで試していない」ことが原因とされる。

## このHarnessとの差分

### 表4: 実績ワークフローにあってHarnessにない要素

| 要素 | 実績ワークフロー | このHarness（AGENTS.md） | 判定（推論） |
| --- | --- | --- | --- |
| 探索中に対象を実行する | Mythos、Anthropic 0-days、Firefox、XBOWは、探索エージェントが隔離環境で対象を動かして仮説を確かめる | 探索は読み取り専用の`Target Snapshot`だけで、実行時攻撃を行わない | **最大の差。** 公開された高い真陽性率（Glasswing 90.6%、Firefox全件真陽性）は実行で確かめた結果である。ソースだけの探索で同じ精度が出る公開証拠はない |
| 人間レビュー前の自動検証 | 発見と検証を別の仕組みにし、人間は検証済みのものだけを見る | `Human Candidate Review`が実行時検証（`Candidate Verification`）より前にある | **順序が逆。** 人間が未検証の候補を採否する。利用者は「人間の承認の質は低い前提で仕組みを設計する」方針なので、この順序はリスクになる |
| 網羅のための分担と事前の順位付け | ファイル単位の割り当て、1〜5の順位付け、全ファイルのループ | 読む順序と分担はルートAIが決め、Harnessは固定しない | AGENTS.mdの「固定段階なし」と矛盾しない形にできる（ルートの作業メモまたはpromptの技法として）。Harnessで強制する必要はない |
| 「本物で重要か」の最終判定役 | Mythosの最終エージェント | ルート内の敵対的な二重確認と`Programme Research Boundary` | ほぼ対応する。発見役と独立した新しいセッションで行うかが違いになる |
| 大量の独立試行 | Heelan 100回/設定、Mythos 1,000回/プロジェクト | 一つのキャンペーンを同じチェックポイントから継続する。pass@3は評価用 | 公開事例は「多数の独立実行の和集合」で再現率を稼ぐ。Harnessの継続型と、どちらが再現率に効くかは未測定 |
| 過去脆弱性・commit履歴の参照 | 亜種分析の出発点、能力の較正 | 探索では使わない（oracle-free） | 意図的な差。評価の公正さのためには正しい。ただし本番キャンペーンで「同じpluginの過去修正の兄弟箇所」を見ない分、再現率は下がり得る |
| 報告へのパッチ案と最小テストケース | Firefox | 非公開の再現手順、`Submission Draft` | パッチ案はない。WordPressの報奨プログラムでは必須ではない |
| 開示ペースの調整・既存修正の確認 | Glasswing | 実行直前に版とソースの鮮度を再確認する | 概ね対応する |

### 表5: Harnessが余計に（または重く）持つ要素

| 要素 | 公開事例での扱い | 推論 |
| --- | --- | --- |
| `Approved Target Batch`（人間による対象承認） | 対象は機械的に広く取り、人間は承認しない（Mythos、Carlini、XBOWの採点） | 人間ゲートを探索の入口に置く公開事例はない。安全のための承認として残すなら、件数を絞る判断はAIの`Target Proposal`に任せ、人間は一括承認にする方が公開事例に近い |
| 全プログラムの対象範囲評価、`Parked Programme Lead` | 明示的な成果物はない（人間が暗黙に行う） | 報奨プログラムへ提出する製品としては妥当。ただし探索の再現率には寄与しない |
| 一度だけの新しい動的検証 | 公開事例は探索中に何度も実行し、最後に人間が再現する | 「一度だけ」は監査上は強いが、自動検証を探索側へ寄せられない分、人間の負荷が増える |
| `External Action Authorization` | Anthropic、XBOWとも人間が提出前に確認する | 同等。余計ではない |

## このリポジトリが合わせるなら

### 推奨A: Anthropic Mythos Preview足場 + Glasswing開示パイプライン

**Observed:**
- 隔離・ネット遮断コンテナ、短いprompt、ファイル単位の順位付けと分担、対象を実行して仮説を確認、最終の別エージェントによる「本物で重要か」判定（[Mythos Preview, 2026-04-07](https://www.anthropic.com/research/mythos-preview)）。
- 人間（または独立した外部企業）による再現 → 重大度の再評価 → 既存修正の確認 → 報告。評価済みの90.6%が真陽性（[Glasswing, 2026-05-22](https://www.anthropic.com/research/glasswing-initial-update)）。
- 最小テストケースが保守者側の検証コストを下げた（[Mozilla, 2026-03-06](https://blog.mozilla.org/en/firefox/hardening-firefox-anthropic-red-team/)）。

**Inference:**
- 構成は`Target Intelligence -> Research -> Human OS`とよく対応する。違いは、**実行による確認が人間の採否より前にあるか**だけである。
- 合わせる場合の最小変更は、`Human Candidate Review`の前に**自動の隔離実行検証**（新しい使い捨てLab、nonce付きcanary、実際のWordPressインターフェース）を置くことである。人間は検証済みの候補だけを採否し、プログラムへ提出するかを判断する。これはAGENTS.mdの「採用された候補だけを`Candidate Verification Request`としてHuman OSへ渡す」順序を変えるため、**ADRでの置き換えが必要**である。
- 注意: Mythos自身が書く通り、WordPressで多いアクセス制御・ロジック系はASanのような判定基準がない。メモリ破壊での90%台の精度を、WordPressへそのまま期待してはいけない。

### 推奨B: XBOWの発見と検証の分離（権限系の振る舞い基準を含む）

**Observed:**
- 「発見するエージェントと確認する仕組みは決して同じではない」「創造的なAIが発見し、決定論的なロジックが本物かを決める」（[XBOW, 2026-03-02](https://xbow.com/blog/we-ran-1060-autonomous-attacks)）。
- IDORでは、検証器が両論を戦わせる方式は「アプリの本来の振る舞いを知らない」ため弱かった。各ロールで普通に操作した観測を基準にし、複数アカウントで境界を越えたかを判定する方式に変えた（[XBOW, 2026-05-28](https://xbow.com/blog/xbow-finds-idors-high-accuracy-ambiguous-context)）。
- XSSはheadless browserで実行を確かめる。検証器の仕組みは[2025-06-24](https://xbow.com/blog/top-1-how-xbow-did-it/)、誤判定の公表は[GPT-5の記事](https://xbow.com/blog/gpt-5)（検索抜粋のみ確認）。

**Inference:**
- WordPressの報奨で件数の多いBroken Access Control、Privilege Escalation、IDOR（既存資料のdaroo / Rafieの分布）では、**未認証 / Subscriber / Administratorの各ロールで正常に操作した記録を先に取り、候補の操作がその基準を越えるかで判定する**方式が、Human OSの`Candidate Verification`に最も直接に使える。
- 種類ごとの判定（XSSはブラウザでの実行、RCEは既存の`Execution Canary`、ファイル操作はnonce付きの痕跡）は「成功条件を明確にするために種類を使う」というAGENTS.mdの規則と矛盾しない。種類を候補採用の条件にはしない。

### 参照しないもの（推論）

- **Wordfence PRISM / Argus / Eclipse:** 対象領域は最も近いが、構成、選定、誤検知率が非公開で、外から「確立された設計」として写せない。観測できるのは「探索エージェント → AIトリアージ → チームによるPoC確認 → ベンダー連絡」という外形だけで、これは推奨Aの外形と同じである。
- **Heelan / Carlini:** 単純なループと大量の試行で成果を出した重要な実証だが、どちらも検証を人手に頼り、本人が検証を上限と述べている。設計の参照ではなく、「検証を自動化しないと積み残しが増える」ことの証拠として使う。
