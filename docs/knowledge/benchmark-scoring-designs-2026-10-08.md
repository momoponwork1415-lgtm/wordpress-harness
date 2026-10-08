# 調査資料: 脆弱性発見ベンチマークの判定・精度・少数サンプル設計

状態: 一次資料に基づく調査、2026-10-08確認。2026年の資料を優先した。2024–2025年の資料は、後継の公式更新を探してから定義や比較対象として使う。既存の[安価なモデルの調査](cheap-model-prospective-vulnerability-discovery-2026-09-16.md)と[参考ハーネスの比較](reference-harness-observability.md)にある事実は繰り返さない。

## 結論

- 公開資料の「発見した」は5系統に分かれる。(1) 実行による証拠（crash、flag、状態probe）、(2) 位置の機械照合（file / line / CWE）、(3) 人間のrubricによる同一性判定、(4) LLM判定、(5) 外部専門家・maintainerによる確認。2026年の再発見ベンチマークのうち明確なものは、見出しの数値を(3)か(1)で出し、LLM判定は補助診断に留める（[Mythos-Linked Rediscovery](https://arxiv.org/html/2605.17416)）。LLM判定を採点に使う場合は、未監査であることを明記する（[HoF-Bench](https://arxiv.org/html/2607.27030)）。
- 位置だけでは同一性を判定できない。HoF-Benchは「file proximity or vulnerability class alone is insufficient」とし、場所、root cause、攻撃者の制御、影響の一致を要求する。逆に、位置の機械照合（RealVuln: path + CWE + ±10行）は再現性が高い。ただし、同じ箇所にある別の原因を区別できない。
- 精度は「既知陽性だけのbenchmark」から測れない。全taskが陽性のHoF-Benchは、一致しない指摘を偽陽性と呼ばず、再発見1件あたりの確認負荷を報告する。精度を出す資料は、(a) 人間が全候補をtriageする（Semgrep 2025: 14% / 18%）、(b) 修正版や安全な類似コードを負の対照にする（OpenSSF CVE Benchmark、Vulnerability Localization Benchmark Phase B、RealVulのFP trap）、(c) 外部firmが抽出標本を評価する（Glasswing: 1,752件中90.6%が真陽性）、のいずれかである。
- 白箱での「偽陽性10–50%」（arXiv 2605.23243）は、function単位の二値分類で、良性functionを脆弱と判定した割合である（本文では15.3–45.8%）。agentによるrepository全体の探索で、Candidateあたりの偽陽性率を示す数値ではない。
- pass@kの意味は資料ごとに異なる。「k回中1回でも当たる」和集合（Aikido、MobileCybench pass@2、HoF-Bench pass@4）、部分集合で平均した不偏推定（HoF-Bench success@k）、全回成功（pass^k、Aikidoの「consistent」）がある。試行の独立性を、別プロセスや別sessionより強く保証した公開資料は見つからなかった。MobileCybenchは、同じモデル名でもクローズドなendpointの中身が変わり得ると注意している（検索要約のみで確認）。
- 汚染対策は4種類である。(1) 公開日とmodel cutoffで分割して比較（CyberGym、SEC-bench）、(2) 再現exploitやdatasetを非公開にしてcanaryを置く（CVE-Bench、XBOW）、(3) 別のcodebaseへ移植する、または合成する（ZeroDayBench、AVDH）、(4) 振る舞いの監査（Semgrepの反事実・識別子改名、Aikidoが観測したQwenによる旧CVEの想起）。凍結したsnapshotに対して後から公開されたCVEで採点する厳密な前向き評価の公開例は見つからなかった。
- 少数サンプルについて、2026年の厳密な資料は区間か記述統計の限界を明記する。HoF-BenchはWilson区間とCVE単位のbootstrapを使い、区間が0を含むので文脈の効果を主張しない。Mythos-Linked Rediscoveryは「3 attempts…not enough to estimate small success probabilities」とする。held-outが5件だと、5/5でも95% Wilson区間は[0.57, 1.0]である。

## 証拠の境界

- 「Observed」は、論文本文、公式ブログ、公式GitHubで確認した事実である。「Inference」はこのrepositoryへの判断である。WebFetchの要約を経た引用は、該当節を確認できたものだけ載せた。
- 本文を取得できず、要約や検索結果だけで確認したものは、その旨を書く。OpenAI Aardvarkの「golden repositoriesで92%」は公式記事が403を返したため、二次引用でしか確認していない。MobileCybenchのcutoffに関する注意書きも本文未確認である。
- 既知陽性の再発見、exploitの再現（CyberGymのLevel 1など）、前向きな新規発見を混ぜない。再現系のbenchmarkは、root causeの説明を与えた上での成功率である。
- vendorによる自社比較（Semgrep、Aikido、XBOW、Anthropic）は、harnessとmodelの交絡と選択の偏りを含む。

## 1. 判定方法の比較

| 公開日 | 資料 | 判定方法 | 何を一致とみなすか | 記録された弱点 |
| --- | --- | --- | --- | --- |
| 2025-06、v3 2026-03-24 | [CyberGym](https://arxiv.org/html/2506.02548) | 実行（sanitizer） | 修正前でcrashし、修正後でcrashしない。Level 0–3で与える情報を変える | 主課題のLevel 1は説明文を与える。修正後にもcrashした759件は、最新版で35件、手作業のRCAと重複除去の後に固有zero-day 9件まで減った |
| 2025-06（NeurIPS 2025） | [SEC-bench](https://arxiv.org/html/2506.11791) | 実行（sanitizer） | 期待した位置で正しい脆弱性種別を報告する（§2.4） | 検証済みinstanceは著者2名が全件を人手で点検した。gold stack traceとの厳密照合は明記されていない |
| 2025-03、repo v2.1.0 2026-01-12 | [CVE-Bench](https://arxiv.org/html/2503.17332)、[repo](https://github.com/uiuc-kang-lab/cve-bench) | 実行（環境の状態） | 8種類の標準攻撃結果を評価serverが自動確認する。40 CVE中11件がWordPress本体またはplugin | [ABC](https://arxiv.org/abs/2507.02825)の適用で過大評価を33%減らした。v2.1.0は任意file uploadを評価基準から外し、RCEへ置き換えた（理由は未記載） |
| 2024-11、2026-05-12 | [XBOW benchmarks](https://xbow.com/blog/benchmarks)、[Mythos評価](https://xbow.com/blog/mythos-offensive-security-xbow-evaluation) | 実行（flag / 検証済みexploit） | flagの完全一致。2026年版は既知脆弱性を持つOSSを脆弱版で凍結し、80 action以内に「validated way to act」を得たら合格（PoC‖GTFO） | 2024年版には「now outdated」と追記された。2026年版は、harvestの仕方によりsourceだけで発見できる集合だと認める。実行回数と偽陽性率は未記載 |
| 2026-09-21 | [MobileCybench](https://arxiv.org/html/2609.23980) | 実行（性質probe） | probeは既知のbugではなく安全上の性質を表す。seeded baselineからexploitを再生し、probeが発火すれば成功 | 何もしない再生ではprobeが発火しない（0/25）負の対照を持つ。発火しないことは「確認した性質を破らなかった」だけを意味する |
| 2026-03-02 | [ZeroDayBench](https://arxiv.org/html/2603.02297v1) | 実行（修正後にexploitが塞がるか） | 実CVEを機能の似た別codebaseへ移植し、zero-dayからfull-infoまで5段階の情報で評価する | 学習データに含まれないことは保証しない。Grokのgit cloneによるreward hackを分析から除外した |
| 2026-07-29 | [HoF-Bench](https://arxiv.org/html/2607.27030) | LLM判定（盲検） | 同じコード経路または部品、root cause、攻撃者条件、影響。match / partial / no_match / insufficient_evidence | 「judge and semantic deduplication…have not been human-audited」。judgeと一部の検出器が同じvendor系列 |
| 2026-05-17 | [Mythos-Linked Rediscovery](https://arxiv.org/html/2605.17416) | 人間のrubric | 場所、root cause、攻撃者が制御するtrigger、もっともらしい影響の4要素。同じfileの別bugは不可 | 自動graderは「rough diagnostic」で見出しの数値に使わない。評価者は著者側のみで、盲検も評価者間一致もない |
| 2026-06-19 | [Neef et al., WordPress plugin](https://arxiv.org/html/2606.21397v1) | 人間（2名） | 公開PoCとの「vulnerability class, endpoint, parameter」の一致 | 対象は既知4件のrecallだけ。1,600件超の指摘の真偽は未評価で、精度は出せない |
| 2026-04-15 | [RealVuln](https://arxiv.org/html/2604.13764v1) | 機械照合 | 正規化したpathの完全一致、許容CWE、正解範囲±10行 | 単一runの結果に不確実性があると著者が認める。不正なJSONはGPT-5で修復してから採点する |
| 2026-09-14 | [Vulnerability Localization Benchmark](https://arxiv.org/html/2609.15939) | 機械照合 | patchが変更した、test以外の実装fileの集合とのfile単位F1 | patchが触ったfileが脆弱性に関係するfileをすべて含むとは限らない、と著者が認める |
| 2026-08-19 | [Mandiant AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) | LLM判定と人間監査 | 合成codebaseへ注入した脆弱性に対する「precise vulnerability matches rather than loose semantic similarity」。別agentが偽陽性と重複を分類し、人間がjudgeを監査する | 合成対象は非公開で、数値もない |
| 2026-08-25 | [Semgrep Mythos IDOR](https://semgrep.dev/blog/2026/mythos-idor-benchmark/) | LLM判定と決定論的照合の混在 | 人間が確認した275 label（うち真陽性144） | Mythosだけ別のjudgeで採点した。「It moved ours enough that we're re-running」 |
| 2026（USENIX Security '26。companion siteに日付なし） | [AIxCC SoK](https://occia.github.io/aixcc-sok-webpage/) | 実行と正誤判定 | 再現できるPoVは正確、再現できないPoVは不正確、重複は中立。SARIF評価は完全に正しい時だけ正確 | SARIF評価は「semi-subjective」とされ、配点が最も低い |
| 2026-04-07 | [Anthropic Mythos Preview](https://www.anthropic.com/research/mythos-preview) | 実行（ASan）と人間 | memory safetyはASanで判定する。論理bugでは「lose the ability to (near-)perfectly validate」 | 人間による検証198件は、深刻度の一致率（89%）を測ったもので、真偽の率ではない |
| 2024-06 / 2024-11、2026-01 | [Naptime](https://projectzero.google/2024/06/project-naptime.html)、[Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) | 実行（crash / assertion） | 原則は「Perfect Verification」 | 後継の公式資料（2026-01の[team member post](https://blog.gnoack.org/post/bigsleep-linux)など）でも、評価方法と偽陽性は公開されていない |
| 2024-07 | [eyeballvul](https://arxiv.org/abs/2407.08708) | LLM判定 | revisionごとの既知脆弱性一覧とLLM scorerで照合 | 古い資料。週次更新の設計例として参照するだけにする |

**Observed:** 実行による判定は、成功条件を観測できる種類だけで強い。2026年にAnthropicは論理bugの検証が難しいことを認め、XBOWは2025年にbusiness logicの自動検証が難しいと述べた（[Dark Reading経由](https://www.darkreading.com/vulnerabilities-threats/ai-based-pen-tester-top-bug-hunter-hackerone)、二次資料）。性質probe（MobileCybench）と状態の自動確認（CVE-Bench）は、web系の結果を実行で判定する現実的な形である。

## 2. 精度と偽陽性の測り方

### arXiv 2605.23243の「10–50%」

- [Dahiya et al., 2026-05-22、v5 2026-06-26](https://arxiv.org/html/2605.23243)。白箱評価はVulnLLM-RのUCSB-SURFI test dataを使う、function単位の二値（脆弱 / 良性）とCWEの判定である。真陽性にはCWEの完全一致を要求する（§3.4）。
- FPRは「Fraction of benign samples incorrectly flagged as vulnerable」（§3.3）。Table 2の値はCodex 5.3が15.3%、GPT-5.4が33.3%、Opus 4.7が36.1%、Sonnet 4.6が43.1%、Gemini 3 Flashが45.8%である。著者のdomain特化modelは9.7%だった。abstractの「10–50%」は丸めた範囲である。
- 信頼区間も汚染分析もない。黒箱評価の5 applicationは、著者modelの学習環境としても使われている（Appendix F）。
- **Inference:** これはfunctionを与えて判定させるclassifierの誤報率である。agentが自分で入口を選び、source traceを付けて出すCandidateの偽陽性率へ流用しない。

### Candidateあたりの真陽性率（公開値）

| 公開日 | 資料 | 分母 | 真陽性の判定 | 値 |
| --- | --- | --- | --- | --- |
| 2025-09-02 | [Semgrep: Claude Code / Codex](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex) | 全445件を人間がtriage | 手作業で判定し、IDORと認証bypassの多くは動的に確認 | Claude Code 46/330（14%）、Codex 21/115（18%）。SQLiはClaude Codeで2/38 |
| 2026-05-22 | [Glasswing update](https://www.anthropic.com/research/glasswing-initial-update) | high / criticalと評価された候補のうち、評価済みの1,752件 | 外部firm 6社（一部はAnthropic自身） | 真陽性90.6%（1,587）、high / criticalの確認は62.4%。抽出方法と偽陰性は未記載 |
| 2026-06-18 | [Cloudflare VDH](https://blog.cloudflare.com/build-your-own-vulnerability-harness/) | raw candidate 20,799件 | 別modelの反証役と決定論的なpath確認 | 検証を通過したのは約12,057件、対応可能は7,245件。初回検証の棄却率は40%から11%へ下がった |
| 2026-09-15 | [Plug 'n' Pray](https://arxiv.org/html/2609.17164v1)（WordPress plugin上位300件） | agentの指摘81件 | 著者が同じ環境で再現 | 79/81（98%）。AST方式との合算を母集団にしたrecallは62/69 |
| 2026-08-27 | [Semgrep Multimodal](https://semgrep.dev/blog/2026/idor-detection-benchmark-semgrep-multimodal) | 275 label | 照合方法は未記載 | Mythosの精度80.1%、recall 13.9%。label外の指摘をどう扱うかは未記載 |

### 反証役・検証段による削減（公開値）

- Cloudflare: 候補20,799件のうち約42%が検証で落ちた。Recon contextの改善で初回の棄却率が40%から11%へ下がった（同上）。「deliberately tuned to over-report」（[2026-05-18](https://blog.cloudflare.com/cyber-frontier-models/)）。
- [Sifting the Noise（2026-01、v3 2026-07-23、ISSTA 2026）](https://arxiv.org/abs/2601.22952): SAST警告の偽陽性除去で、OSS-Fuzzのcutoff後のsetについて、SWE-agentとSonnet 4は偽陽性の95.5%を識別した。単純なpromptでは36.4%だった。abstractは、真陽性の損失を「aggressive FP reduction can come at the cost of suppressing true vulnerabilities」と定性的に書くだけである。
- Anthropic: 最後のagentに「confirm if it's real and interesting」と再確認させる段がある。削減量は未公開。
- AVDH: 高温の複数Validationと統合段を持つ。「significantly elevates the precision」とするが、数値はない。
- HoF-Bench: 精度の代わりに、重複除去したcluster数を再発見CVE1件あたりで報告する（文脈ありで4.1、なしで3.4）。
- **Observed:** 削減率を出す資料はどれも、真陽性を削った量（recallの損失）を同じ表で出していない。

## 3. pass@kと独立試行の和集合

| 定義 | 資料 | 意味 |
| --- | --- | --- |
| union@k | [Aikido 2026-08-21](https://www.aikido.dev/blog/ai-model-benchmarks-aug-21-2026)、[MobileCybench](https://arxiv.org/html/2609.23980) pass@2、HoF-Bench pass@4 | k回中1回でも当たればcaseを数える |
| success@k（不偏推定） | [HoF-Bench](https://arxiv.org/html/2607.27030)、定義は[Chen et al. 2021](https://arxiv.org/abs/2107.03374) | n回から作ったk回の部分集合すべてについて、当たったcase数の期待値を平均する。kより多くrunする必要がある |
| pass^k / consistent | [τ-bench 2024-06](https://arxiv.org/abs/2406.12045)、Aikidoの「found…in all three runs」 | k回すべてで成功。信頼性の指標 |
| success@5 | [CVE-Bench](https://arxiv.org/html/2503.17332) | 5回試行した設定での成功 |
| 平均と標準偏差 | [SEC-bench](https://arxiv.org/html/2506.11791)、[VLB](https://arxiv.org/html/2609.15939) | SEC-benchはo3-miniを5回実行して30.0% ± 7.9%。VLBは3回の平均 |
| システム間の和集合 | CyberGym | 異なるmodelやagentの和集合で、同一条件のpass@kではない |

- 独立性の保証として公開されている内容は、fresh session、最大turn数、internetなし、case / Prompt / tool / 評価方針の固定（Aikido）にとどまる。Naptimeは「multiple independent trajectories」と書くだけである。それ以上の保証（provider側cacheの排除、model buildの固定）を示した資料は見つからなかった。
- Semgrep 2025は、同じpromptを同じappで繰り返すと指摘が毎回変わり（3→6→11件）、部分的にしか重ならないと報告した。Semgrepの[grounding監査 2026-07-17](https://semgrep.dev/blog/2026/grounded-or-gamed-we-audited-our-own-cyber-benchmark/)では、run間の安定性が0.63–1.0だった。5 modelの和集合で29.6%、最良の単独modelで26%で、見逃しは重なっていた。
- **Inference:** union@3は見つける力、pass^3は再現性を測る。2つは逆方向へ動き得るので、片方だけを報告しない。

## 4. 汚染と時点切り

| 方式 | 資料 | 観測 |
| --- | --- | --- |
| cutoff前後で分割して比較 | CyberGym（Fisher検定とZ検定、全p > 0.1）、SEC-bench（前後15件ずつ、Wilcoxon p = 0.27） | 差は検出されなかった。ただしSEC-benchは30件と少ない |
| 時点で分けた検出benchmark | [CWE-Trace 2026-06-18](https://arxiv.org/abs/2606.20502)、[VentiVul（v3 2026-08-17）](https://arxiv.org/abs/2512.10485) | CWE-Traceは、名目上汚染されたsampleの84%に使える記憶信号がないと報告した。VentiVulでは、新しい脆弱性で性能が大きく落ちた |
| 再現を非公開にし、canaryを置く | CVE-Bench（manual exploitを非公開）、XBOW（canary string） | datasetが漏れるのを遅らせる。modelが元のCVE本文を学習していることは防げない |
| 移植・合成 | ZeroDayBench、AVDH（注入した脆弱性を人間が到達可能・悪用可能と確認） | 実際の分布と一致する保証はない |
| promptからの除去 | Mythos-Linked Rediscovery（CVE ID、patch hash、advisory、作者、日付をpromptから除く） | cutoffとpatch公開日の比較はしていない |
| 振る舞いの監査 | Semgrep（patchで修正した後の再走査、識別子の改名、安全な類似コード、安定性）、Aikido（Qwenは96 trace中95で、旧CVEを記憶から検討した） | 記憶による回答を、traceと反事実の実験から検出する |

- **前向き評価:** Anthropic Mythosは、記憶の可能性を断つためにzero-dayを使うと述べる。CyberGymは公開日をcutoffで分けた。Neef et al.はcutoff後に公開された4件を選んだが、cutoffを確認できなかったと書く。探索対象を凍結し、その後に公開されたadvisoryで事後に採点する形の公開例は見つからなかった。
- **開発セットとheld-outの分離:** 明示的にheld-outを持つ公開資料は少ない。AVDHは「strict review processes to actively prevent the AI from overfitting to these benchmark codebases」と述べるだけで、分離の手順は書いていない。

## 5. 少数サンプルの統計

- HoF-Bench（95 CVE）: modelごとに95% Wilson区間を付ける。文脈の効果は+2.2 ptで、CVE単位bootstrapの区間[−6, 47]が0を含むので主張しない。portfolioの結果は探索的と表示する。
- Mythos-Linked Rediscovery（6 task × 3回）: 5/18と1/18の差を記述統計に留め、Appendix Bで試行数が小確率の推定に足りないと書く。
- Neef et al.（既知4件）: 区間も検定もない。modelごとの比較は、60 cell中38と29の差だけに基づく。
- [Bowyer et al., ICML 2025](https://arxiv.org/abs/2503.01747): 数百件未満でCLTに基づく区間を使うと、不確実性を大きく過小評価する。
- 既存資料のAikido（26件、32件）、AISLE、Code-Augurも区間を付けていない。
- **Inference（計算値）:** n = 5で95%区間を計算した。

| 当たり | Wilson | Clopper-Pearson |
| --- | --- | --- |
| 5/5 | [0.57, 1.00] | [0.48, 1.00] |
| 4/5 | [0.38, 0.96] | [0.28, 0.99] |
| 3/5 | [0.23, 0.88] | [0.15, 0.95] |
| 0/5 | [0.00, 0.43] | [0.00, 0.52] |

  admit済みCandidateがm件ですべて`runtime-confirmed`だった場合、偽陽性率の片側95%上限は、m = 10で0.26、m = 30で0.095になる。

## 6. スコアラーの自動化

| 形式 | 資料 | 機械的な規則 | 限界 |
| --- | --- | --- | --- |
| JSON（cwe, file, line, severity） | RealVuln | path、CWE、±10行。真の脆弱性をFP trapより優先し、正解1件を消費するのは1回だけ。代替の場所を一つでも満たせば偽陽性にしない | CWEの粒度と行のずれに依存する。F3を主指標にし、recallを9倍重く扱う |
| file集合 | VLB | patchが触った、test以外の実装file。修正版で何かを出せば偽陽性 | file単位では粗い |
| 修正前後の対 | [OpenSSF CVE Benchmark](https://github.com/ossf-cve-benchmark/ossf-cve-benchmark)（2020年開始、後継は見つからなかった） | 脆弱版で検出し、修正版で黙るか | ruleベースのツールを前提にしている |
| SARIF | AIxCC | 主催者が配信したSARIF（13件中8件が正、5件が誤）の真偽を判定させる | 主観が入るため配点は最低 |
| 構造化したfindingとLLM judge | HoF-Bench（title、path、line range、root cause、attacker control、impact、evidence、confidence） | judgeは検出器の正体、条件、試行番号を知らない盲検 | 人間による監査がない |
| 実行時のprobe / 状態 | MobileCybench、CVE-Bench | 性質の違反や標準攻撃の結果を自動確認する | 状態として観測できる影響だけを判定できる |
| 精度の罰則 | AIxCC: AM = 1 − (1 − r)^4 | 正確な提出の比率rで総点を割り引く | 正確性が50%でも0.9375倍と罰が緩い |

## このリポジトリが採用するなら

前提: 既知陽性はheld-outの5件（Stored XSS / SQLi / 管理者乗っ取り）。Researchへ答えを渡さない。単位は`Research Candidate`と、admitされた後の`Candidate Verification`。

### Observed（根拠）

- 位置またはクラスだけでは同一性を判定できない。両rubricは、場所、root cause、攻撃者条件、影響を要求する（[HoF-Bench](https://arxiv.org/html/2607.27030)、[Mythos-Linked](https://arxiv.org/html/2605.17416)）。
- LLM judgeは、未監査のまま見出しの数値に使わないか、使う場合は限界を明記する（同上）。judgeを変えると結果が動いた例がある（[Semgrep 2026-08-25](https://semgrep.dev/blog/2026/mythos-idor-benchmark/)）。
- 既知陽性だけの集合では、一致しない指摘を偽陽性と呼べない（HoF-Bench）。recallを主張できるのは正解を固定した集合だけである（[Cloudflare](https://blog.cloudflare.com/build-your-own-vulnerability-harness/)）。
- 修正版や安全な類似コードを負の対照にすると、対象の性質について誤報を機械的に数えられる（OpenSSF、VLB Phase B、RealVulのtrap、Semgrepのcounterfactual / selectivity）。
- web系の結果を判定する実行oracleには、性質probe（MobileCybench）と状態の自動確認（CVE-Bench）がある。
- n ≤ 7では区間が広い。厳密な資料は区間を併記するか、記述統計に留める（HoF-Bench、Mythos-Linked、Bowyer et al.）。

### Inference（推奨）

1. **判定は2層に分け、見出しは人間のrubricで出す。** 各held-outについて、Research外に答えの鍵を事前に登録する。鍵は、入口（hook / route / AJAX action）、破られる安全上の性質、欠けている、または誤っているcheck、攻撃者の権限、到達する影響、許容するfileとfunctionの集合を持つ。
   - **一次判定（機械）:** Candidateのsource traceに、鍵のfile / functionが一つでも含まれるか。これは必要条件だけで、`location-overlap`として記録する。
   - **二次判定（人間、盲検）:** 4要素がすべて一致すれば`target-hit`、一部だけなら`partial`、それ以外は`non-target`とする。評価者には、どの試行や構成のCandidateかを伏せる。LLM judgeは補助として並べてもよいが、見出しの数値には使わない。5件 × 3試行なので、人間の負担は小さい。
   - **実行での確認（既存のHuman OS）:** `target-hit`のCandidateを人間がadmitした場合は、既存の`Candidate Verification`で`runtime-confirmed`かを別に記録する。成功条件には、CVE-BenchやMobileCybenchと同じく、Labの状態で観測できる性質を使う。例: 権限の低い主体が書いたnonce付きの値が管理画面のcontextで実行される、権限のない主体が管理者状態を得る、nonce付きの値が意図しないqueryの結果に現れる。recallは、Candidate水準の`target-hit`と実行水準の`target-hit ∧ runtime-confirmed`の2本を併記する。
2. **精度はheld-outの陽性からは測らず、3つの量で代える。**
   - (a) 負の対照: 各held-outについて、修正版の同じpluginで同じ条件のCampaignを回す。鍵と同じ性質を主張するCandidateが出れば`control-false-alarm`として数える。修正版にある別の本物のbugを偽陽性にしないため、数えるのは鍵の性質と一致する主張だけにする。
   - (b) Candidate全体の内訳: held-outのCampaignが出したCandidateを、`target-hit` / `partial` / `non-target`と、admit後の`runtime-confirmed` / `contradicted` / `incomplete`に分けて数える。`non-target`は偽陽性と呼ばない。`incomplete`は否定へ丸めない。
   - (c) 負荷: 1回の試行あたりのCandidate数と、`target-hit`1件あたりの重複除去前のCandidate数（HoF-Benchのreview burdenに相当）。
   - 偽陽性率を数値で主張するのは、admit済みCandidateの`contradicted`比率と、その片側上限（Clopper-Pearson）だけにする。
3. **pass@3は3つの量で表示する。** caseごとに3試行の当たり行列（5 × 3）を保存し、union@3、pass^3（全回）、試行ごとの当たり率を併記する。success@kの不偏推定はn > kの時だけ使う。独立性は、既存の[探索設計](../RESEARCH-DESIGN.md)のfresh campaign条件をそのまま使い、model buildを確認できない試行はunknownと表示する。
4. **少数サンプルでは比較を主張しない。** k/5にはClopper-Pearson区間（保守的）を付ける。種別ごと（XSS / SQLi / 管理者乗っ取り）のrecallは件数のまま表示し、率にしない。構成Aと構成Bの差は、同じcaseと試行の対で示す。5件だけでは改善を主張せず、「同等以上で負荷が減った」程度に留める。
5. **汚染を記録し、held-outを使い捨てる。** caseごとに公開日、model cutoff（不明ならunknown）、advisoryがあるかを保存する。試行のtraceからCVE ID、advisoryの文言、修正版番号の想起を機械的に検出して印を付ける（Aikidoが観測したQwenの挙動）。held-outの採点結果を開発者が見て探索のPromptを変えたら、そのcaseを開発セットへ移す。新しいheld-outは、本人の未公開の発見を公開後に追加するか、将来のoracle-free Campaignの結果を後から公開されたadvisoryで照合する前向きな集合として育てる。
