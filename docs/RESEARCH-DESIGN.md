# 探索設計

状態: 採用済みの探索方針、2026-09-19

<a id="goal"></a>
## 目的

既知脆弱性を答えとして与えずに、影響の大きい「壊れた安全上の性質」を高い再発見率で見つけます。人間が採用した候補だけを新しい実環境で確認し、`runtime-confirmed`からだけ確認済み脆弱性を作ります。技術的な真偽と報奨金プログラムの対象範囲は分離したまま、提出判断までつなげます。

**Do not optimize for sinks. Optimize for broken security semantics.**

深く追う対象は、未認証または購読者・顧客権限から到達できる任意PHPファイルのアップロード・読み取り・削除、任意オプション更新、RCE、認証回避、管理者への権限昇格、格納型XSS、SQLインジェクション、そしてプログラム上重大な無許可のデータ変更・読み取りです。利用規模、WordPress.org掲載、premium版の適格性は対象情報の領域が受入時に判断し、探索で計算し直しません。RCEは最上位の影響ですが、別の対象影響を無理にRCEまで伸ばす必要はありません。

<a id="decision-ownership"></a>
## 判断の担当

Harnessは探索判断そのものではなく、AIが安全に判断できる条件と証拠を所有します。

| 領域 | Harnessが持つもの | AIが持つ判断 |
| --- | --- | --- |
| 対象選定 | 既知脆弱性を含まない候補群、ソースの同一性、最新性、予算、人間による一括承認 | 優先する対象、理由、不確実性、再調査する価値 |
| 探索 | 対象・依存ソース、Prompt、権限、Campaignの安全上限、記録、終了状態、人間による候補採否 | 仮説、native subagent、読む順序、探索内の継続・停止、候補、保留する手掛かり |
| 候補の動的検証 | 候補と再現手順の結び付き、新しいWordPress / MySQL環境、非公開証拠、確認済み脆弱性の生成条件 | 制限された再現操作、実効性の判定 |
| 対象範囲と人間による運用 | 設定済みプログラム、対象範囲の記録、提出候補、外部行動の承認 | プログラムごとの適合性、理解支援、提出文案の作成 |

固定順位、多様性の上限、理由コード、作業者の役割、探索者数、探索の波、深さ、探索方式、固定評価表をAIの判断の代わりにしません。schemaは同一性、権限、証拠、失敗時の扱い、領域間の受け渡しを固定するために使います。

<a id="design-lineage"></a>
## 設計の出発点

探索設計の出発点は、Wordfence Argusが公開した「**confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, and then iterate hard and fast**」という10の動詞、[wp2shellの実際のprompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)、その元になったOpenAIの[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)です。[Argusの記事](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)は詳細を公開していないため、このリポジトリでは10の動詞を次のように具体化します。

| 原則 | このリポジトリでの意味 |
| --- | --- |
| confine / constrain | gVisor、読み取り専用ソース、権限、予算、版管理された結び付きで実行境界を固定する |
| focus / motivate / prioritize | 対象承認、攻撃者の前提、プログラム上の境界、Promptで目的を明確にし、優先順位と想定外の候補はAIに残す |
| parallelize / hypothesize | プロバイダー固有のRootとsubagentが、独立した経路と反証可能なソース根拠を作る |
| verify / record | 探索内の敵対的レビュー、別環境での動的検証、確認済み脆弱性、プログラムの対象範囲、追記専用Receiptを分離する |
| iterate hard and fast | Rootが統合・反証・方向転換を繰り返し、ソースに基づく`continue`なら同じCheckpointから自動で次へ進む |

wp2shell promptの探索手法は[wp2shell由来のPrompt](../prompts/wordpress-plugin-research-v3.md)へすべて取り入れます。具体的には、先入観なく生のソースから考えること、native multi-agentを積極的かつ動的に使うこと、固定担当を置かないこと、十分に異なる探索経路を持つこと、探索方式を明示して偏りを避けること、収束時に未調査の方式へ戻すこと、一つの有望経路だけに支配させないこと、新しい手段がある時だけ行き詰まった経路を再開すること、相性の悪い経路も複数回維持して後から知見を交差させること、具体的なバグを別視点で二重確認すること、Rootが統合・反証・方向転換・次の探索を繰り返すこと、最初の探索や現在の方式が失敗しただけで止めないこと、依存ソースを読んで欠けた接続や中間バグをつなぐことです。

wp2shell由来のPromptはCloudflareの公開security-audit skillからも、具体的な安全上の不変条件、ソースから見える最も強い防御の再構成、類似処理・旧処理・ライフサイクル・失敗経路の比較、異常時の試験を採用します。[Cloudflare由来のPrompt](../prompts/wordpress-plugin-research-cloudflare-v1.md)は、公開skillの偵察、調査範囲を意識した探索、敵対的な検証、抜けの補完を、Rootが所有する一つの連続探索へ適応します。固定Hunter、固定Wave、決定論的な調査台帳、発見件数による完了判定は、通常のCloudflare方式とwp2shell方式には採りません。比較実験用の[Cloudflare公開方式そのものに近いPrompt](../prompts/wordpress-plugin-research-cloudflare-upstream-v1.md)だけは、固定した公開skillの全体監査手順、非公開の調査台帳、探索・批評の波、新しいソースによる確認を探索方式の内部で維持します。その作業成果物をHarnessの状態、探索範囲の正本、安全性の証明には昇格させません。

持ち込まないのは、wp2shell固有の「脆弱性が存在し、未認証RCEから`/flag`へ必ず到達する」という正解の先出しと、最低6時間の指定だけです。元のCDC promptにある肯定解と最低8時間も同じ理由で採りません。最大4体は固定担当ではなく資源上限として使い、探索方式の一覧はRootの作業領域に置きます。実行中の依存ソース取得は、事前に固定した読み取り専用の依存ソースへ置き換えます。これは探索要素の省略ではなく、未知対象の調査、再現性、隔離、人間による候補採否へ適応するための境界です。速さを理由に証拠、隔離、候補採否を省略しません。

Claude Code、Codex、Grokなどが既に持つモデルの反復、context管理、session再開、native subagentの起動・連絡・待機、tool routingはHarness内で作り直しません。Provider Adapterは公式機能の設定と制限を行い、対象・Prompt・実行環境・権限・予算の結び付きとReceiptへ変換します。`AgentRuntimeProfile`は正確なモデル、推論設定、通信方式、実行ファイル版、sandbox image、promptとreportの能力を一つのdigestへ結び付けます。既存の通信方式で動くモデルはprofile catalogへ追加し、モデルごとのAdapterは作りません。新しいAdapterはnative command、session、出力protocolが異なる場合だけ追加します。安全上必要な最小の読み取り専用ソースInterfaceと完全性検査はHarnessが持ちますが、プロバイダー共通のagent framework、会話engine、scheduler、tool DSLは作りません。native機能が使えない、または結果を受け入れられない時は暗黙に代替せず、型の付いた`incomplete`として残します。

<a id="target-selection"></a>
## 対象の選定

対象情報の領域では、既知脆弱性を含まない選定事実から、AIが探索価値を比較して対象を提案します。利用規模、更新状況、他製品との連携、ソース規模、プログラム適格性、報告経路、過去の探索履歴は判断材料にできます。ただし全候補の固定順位、固定区分、固定観点による多様性、列挙済み理由は要求しません。

対象の供給を一種類の推測規則へ寄せません。通常の候補群に加え、呼び出し側が指定したWordPress.orgの更新期間から`trunk`のPHP変更を「更新された対象群」として観測できます。同じ版のソースを取り直して候補群を作ります。更新差分は脆弱性の場所を教える答えではなく、その対象を今読む価値があるという事実です。正確なpath、追加ソース、既知advisory、patch、PoC、影響関数は非公開証拠に留めます。目立つsignalがないPHP変更も候補から落としません。ソース取得不能、古い観測、選定事実の欠損、結び付きの不一致を「未探索」や「適格」と推測で補いません。

Harnessによる強制条件は次に限定します。

- ソースを正規に取得できる。
- プラグインの同一性、版、取得元、標準ファイル一覧を固定できる。
- 実行直前のソースと版が最新の観測と一致する。
- 選択結果が入力候補群に含まれる。
- 人間が探索対象の範囲を一括承認する。

プログラム対象外、報告経路不明、探索済み、またはAIの低評価だけを技術探索の拒否条件にはしません。探索済み対象を再投入する理由と重複して動いているCampaignは記録しますが、再調査する価値はAIが判断します。

<a id="agent-led-research"></a>
## エージェントによる探索

探索方式はPrompt SetとしてCampaign開始前に選び、モデルやプロバイダーの通信方式とは独立して結び付けます。現在の標準方式は次の3つです。

| 探索方式 | 標準Prompt Set | Rootが所有する探索の流れ |
| --- | --- | --- |
| `wp2shell` | `wordpress-plugin-research-wp2shell-v2` / [Prompt](../prompts/wordpress-plugin-research-v3.md) | 十分に異なる探索経路、複数回の反復、遅い知見の交差、繰り返しの統合と方向転換 |
| `cloudflare` | `wordpress-plugin-research-cloudflare-v2` / [Prompt](../prompts/wordpress-plugin-research-cloudflare-v1.md) | ソースの偵察、調査範囲を意識した探索、敵対的な検証、ソースに基づく抜けの補完 |
| `cloudflare-upstream` | `wordpress-plugin-research-cloudflare-upstream-c1c8a8c-v2` / [Prompt](../prompts/wordpress-plugin-research-cloudflare-upstream-v1.md) | 固定した公開版の全体監査手順、非公開台帳、探索・批評の波、新しいソースによる確認 |

標準IDとPrompt digestの対応は[`research-methods.ts`](../src/research/agent-led/research-methods.ts)で固定します。別方式の本文や旧Promptを同じ名前で実行する誤設定は拒否します。方式固有の探索判断はPromptとプロバイダー固有のRootの内側に置きます。`ResearchCampaigns.conduct / inspect`、探索報告、人間による候補採否、Provider AdapterのInterfaceは方式ごとに分岐させません。

プロバイダー固有のRoot agentは対象ソース全体を読み、プラグインが依存するWordPress本体などの挙動を、版を固定した依存ソースから解決します。どの方式でもnative subagentを積極的かつ動的に使い、依存ソース自体を別の監査対象にはしません。Harnessが実行環境で強制するのは、Rootを含めて同時に動けるエージェントが最大4体という資源上限だけです。実際の数、役割、探索回数、脆弱性の種類、読むファイルは指定しません。Rootだけが最大3体のsubagentを起動し、役割、終了後の再投入、次の探索を決めます。探索評価ではGrokを先に使います。利用できない時に同じCampaignを暗黙に別モデルへ切り替えず、GLM 5.3など別の`RuntimeProfile`を結び付けた新しいCampaignとして比較します。

Campaign全体には、人間が承認したNative Run数と総実行時間の安全上限を持たせます。固定1時間を通常の停止点にはしません。各`SealedNativeRun`はCampaignに残る実行時間を受け取り、プロバイダー固有のRootが自然に構造化報告を返すまで探索できます。Harnessはプロバイダーを呼ぶ前に、正確な`SealedNativeRun`、digest、開始時刻を`NativeRunAttempt`として追記します。Receiptは非公開の回復用成果物へ原子的に確定した後だけ、終了eventへ追記します。開始eventだけが残った試行は孤立状態であり、自動再実行しません。同じrun、runtime profile、Receipt digestに一致する成果物だけを回復し、欠落・破損・不一致があれば`incomplete`のまま残します。

探索Rootのプロバイダー固有の会話と作業領域は、非公開の`AgentCheckpoint`として継続できます。Harnessは一定間隔の保存や内部tool eventをdomain modelにはせず、結び付きと完全性を持つ不透明な参照だけを記録します。時間切れやプロバイダー中断の時にCheckpointを保存できなければ`incomplete`であり、再開可能とは扱いません。動的検証へ探索Checkpointを渡しません。

Checkpoint、実行診断、Native Run Receipt、候補の再現手順は、同じ非公開成果物ストレージの規律を使います。ただし、それぞれの意味や参照型は統合しません。各Adapterがrun、候補、sessionなどとの結び付きを持ちます。共通storeは制限された読み書き、原子的な確定、内容ツリーの完全性、pathとlinkの安全性、競合と孤立成果物の検査だけを担当します。孤立成果物を自動修復・削除しません。

探索中の判断は次のとおりです。

```text
対象となる影響への具体的な次の手がある -> continueし、そのCheckpointから自動継続する
対象となる候補がある                   -> 作業領域へ記録し、探索内で敵対的に反証する
対象外の手掛かりだけがある             -> 軽量な保留手掛かりとして保存する
調べる価値のある経路がない             -> 根拠を添えてstopする
外部制約で続行できない                 -> incomplete
```

AIが`continue`を返すと、Harnessは完了したrunの正確なCheckpointとソースに基づく次の手を、次の`SealedNativeRun`へ結び付けて自動開始します。候補の存在だけでは停止しません。AIが`stop`を返した時だけ、候補があれば人間による採否判断へ進み、なければ今回の探索範囲を閉じます。run数または総実行時間の安全上限へ達した時に具体的な次の手が残っていれば`incomplete`です。停止や「発見なし」へ読み替えません。

一つの候補を得ただけでは停止しません。Rootは調査中の経路に限って、native subagentによる敵対的レビュー、知見の統合、方向転換を行います。プログラム境界上で、ソースから支持できる最大の影響が対象外であり、対象となる影響への具体的な接続もない手掛かりは、最小限の証拠を持つ保留手掛かりとして残します。保留手掛かりをsubagentへ委譲したり、人間の候補採否や動的検証へ流したりしません。新しいソース証拠がアカウント乗っ取り、管理者昇格、RCEなどの対象影響へ具体的につながった時だけ、調査中の経路または新しい候補へ昇格します。RCEへ伸びないことだけを理由に、重大なSQLインジェクションや格納型XSSを未完成扱いしません。支持数、モデルの確信度、到着順、static ruleへの不一致、Surface Map外であることを、候補の棄却や安全判定に使いません。

static解析や派生解析の出力があっても、ソースを読む補助と証拠の補助に限ります。探索範囲そのものや完了証明には使いません。現在のエージェント経路は生のソースを直接読みます。

`ResearchReport` v2では、候補に対して、信頼度の低い入口から安全上重要な影響までの順序付きソース経路、ソースから見える最も強い防御への評価、正確な未解決事実を求めます。Native Run内で具体的に調べた重要経路が候補にならなかった場合は、ソースで反証できた`refuted`、または決定的事実が不足する`blocked`として評価を残します。候補の有無にかかわらず、run内で調べた領域をソース証拠付きで示し、未調査領域も明示します。これらはそのrunだけの記録です。次のrunの作業一覧、調査範囲の単位、探索完了、安全性の証明にはしません。

## 独立試行による評価

一つの独立探索試行は、以前の結果やCheckpointを入力せず、新しいCampaignとして始めます。Campaign内で同じCheckpointから自動継続するNative Run、プロバイダー通信の再試行、認証の再試行、出力形式の補正は、すべて同じ試行の一部です。独立試行数は増えません。固定した評価対象群の各対象へ一試行ずつ行う単位を「評価一巡」とします。外部資料の`pass@3`を参照する場合は、単一対象の3試行なのか、評価対象全体の3巡なのかを明記します。保存形式、Interface、探索方式の名前には使いません。

同じ条件の反復を比べる時は、`campaignId`だけを変えます。対象・依存ソース、Prompt Set、攻撃者の前提、プログラム上の境界、`AgentRuntimeProfile`、権限、予算、toolとnetwork条件は固定します。各試行は`resumeFrom`を持たず、新しいプロバイダーsession、home、作業領域を使います。別試行の候補、Checkpoint、報告、人間の判断を入力しません。モデルやプロバイダーharnessのbuildを固定または実行時に確認できなければ、その同一性はunknownのまま表示します。異なる可能性がある結果を同一条件として集計しません。異なるPromptや探索方式を割り当てる比較は構成の比較実験であり、同一条件の反復とは分けます。

比較表示は、既存のCampaign表示、Native Receipt、候補の動的検証、プログラム対象範囲の記録から読み取り専用で導きます。二つ目の更新可能な台帳、`ResearchStrategy.execute`、比較機能による自動探索起動は追加しません。Campaign内部の自律継続は`ResearchCampaigns`だけが所有します。正確な試行集合と、全体の実行時間・run数への人間の承認を先に求めます。比較処理が探索、候補採否、動的検証、外部行動を代行することはありません。

比較では、予定済み・モデル完了・未完了の試行を分け、候補を`campaignId / runId / candidateId`の出所付きで保持します。同じ主張の複数出現、モデルの確信度、schema適合、多数決を技術的な確実性へ変換しません。原因が同じか不明な候補を自動統合しません。`runtime-confirmed`、プログラム対象範囲、事務上の完了、探索範囲は別々に表示します。費用の欠損はunknownであり、0にはしません。正解を固定した既知事例群だけがprecision / recallを主張できます。未知対象のCampaignでは、固有の実環境確認済み脆弱性、重複、未完了、対象内の結果、試行ごとの増分を観測します。

<a id="candidate-verification"></a>
## 候補の動的検証

探索候補は、対象ソース、攻撃者の前提、破られる安全上の性質、主張、順序付きソース経路、防御への評価、未解決事実、非公開の再現手順への参照を持ちます。Rootはソースを理解した同じrunで最小の動的手順を作り、Runtime Adapterが本文をGit外のcontent-addressed storeへ退避します。Campaign記録にはdigest、size、recipe idだけを残します。再現手順を作れなかった候補は棄却せず、`verification-preparation-needed`に留めます。

AIが探索を止めた時に候補があれば、Campaignは`candidate-review-pending`で止まります。人間による候補採否は正確な候補集合へ結び付き、`advance-to-candidate-verification`だけを動的検証依頼へ変換します。`return-to-research`が一件でもあれば、動的検証より先に探索へ戻します。

人間による運用の領域は、依頼ごとに新しい使い捨てWordPress / MySQL環境を作り、候補に結び付いた再現手順を一度だけ実行します。別のAI runでソースから脆弱性を探し直すことはしません。

| 結果 | 意味 |
| --- | --- |
| `runtime-confirmed` | 前提、再現手順、安全上の影響、非公開証拠が揃い、確認済み脆弱性を作る |
| `contradicted` | 通常前提と再現手順は満たしたが、主張した影響を観測しなかった |
| `incomplete` | 環境、依存、再現手順、観測、後片付け、証拠のいずれかが不足し、否定へ丸めない |

確認済み脆弱性の技術的な真偽と、プログラムの適格性は別の成果物です。実環境での確認後に、設定済みの全プログラムを各対象範囲へ照らし、`in-scope`、`out-of-scope`、`ambiguous`、`stale`のいずれかで評価します。すべてのプログラムで対象外でも、確認済み脆弱性は保持します。提出候補は`in-scope`のプログラムにだけ生成し、人間が一つの提出先と文案の正確な版を選んで外部行動を承認します。

複数の対象は、互いに独立したCampaignとprocessとして並列実行します。Harness内へ中央schedulerや対象横断の検証queueを作らず、プロバイダーまたは運用者が既に持つprocess並列性を使います。

## 完了と失敗の扱い

AIがソースに基づく有望な次の手を残さず、Harnessが固定入力、ソースの完全性、最終出力を検査できた時だけ、探索範囲を`closed`にします。候補の動的検証が成功したかとは独立しており、脆弱性が存在しない証明でもありません。

具体的な次の手を残したままCampaignのrun数または総実行時間へ達した場合と、プロバイダー・tool・ソース・権限・schema・保存の失敗は`incomplete`にします。動的検証の準備不足は`verification-preparation-needed`として区別します。プロバイダーが報告する推定費用はReceiptへ保存しますが、Harnessの停止条件にはしません。候補0件、エージェント一回の「発見なし」、時間切れ、Mapの調査率、toolの命中数を探索完了へ読み替えません。

<a id="trust-and-versioning"></a>
## 信頼と版管理

- 対象ソースをホスト上で実行しない。
- 対象・依存ソースは読み取り専用とし、隔離した作業領域だけを書き込み可能にする。
- Rootとnative subagentへ同じ`PermissionProfile`を適用する。
- 周囲のshell、network、認証情報、container socket、host path、plugin、hook、memory、未承認MCPを与えない。
- プロバイダーの生の認証情報はエージェントへ渡さない。必要な通信方式では、固定した接続先とrunへの結び付きを持つ短命な認証中継許可だけを渡す。
- gVisor相当以上のOS-level sandboxと通信能力の事前検査を通らないruntimeは使わない。host processやplain Dockerへ暗黙に切り替えない。
- 対象・依存ソース、Prompt Set、`AgentRuntimeProfile`、`PermissionProfile`、`BudgetEnvelope`、出力をCampaignへdigestで結び付ける。
- プロバイダーやモデルを暗黙に切り替えない。GrokからGLM 5.3へ変える場合も、別の`RuntimeProfile`と新しいCampaign inputを使う。
- 人間の必須判断は、対象群の承認、候補の動的検証への採否、探索範囲や権限の拡張、外部行動の承認、最後の提出に置く。承認済みCampaign内の通常の探索継続には置かない。

Prompt、runtime、権限、探索方針の変更は進行中Campaignへ適用せず、版を上げた新しいCampaignで比較します。現在のbinaryへ旧版reader、feature flag、未使用Adapterを残しません。

<a id="change-gate"></a>
## 変更を採用する条件

変更は次を説明できる場合だけ採用します。

- 公開された既知事例群で、候補と実環境確認済み脆弱性の段階別再発見率を悪化させないか。
- 未知対象のCampaignで、影響の大きい脆弱性の再発見率を悪化させないか。
- Rootとsubagentへの権限継承を実測したか。
- 候補の動的検証で新しい環境を保てるか。
- ソース、プロバイダー、予算、schemaの失敗を否定結果へ丸めないか。
- 公開Interfaceから動作を観測でき、旧内部Testを削除できるか。

診断中核の合否は、答えを与えない既知事例の再発見と、新しい環境での動的検証成立で測ります。修正版や最小対照環境は必要な比較実験でだけ使い、通常の昇格には要求しません。隔離方式、対象選定、探索範囲の閉鎖、コード行数を診断精度の代理指標にはしません。

費用は観測しますが、強制停止の上限にはしません。費用削減は再発見率の基準を確立した後、一変数ずつ比較します。コード行数を設計の証明や目標値にはしません。未使用コード、二つ目の実装がない汎用抽象化、AI判断を作り直すorchestrationは残しません。コード行数が増える場合は、公開された動作で理由を説明します。

## 参考資料

- [ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)
- [ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)
- [ADR 0128](adr/0128-provide-pinned-dependency-source-to-research.md)
- [ADR 0132](adr/0132-treat-provider-cost-as-observational-telemetry.md)
- [ADR 0135](adr/0135-promote-candidates-through-runtime-verification.md)
- [ADR 0136](adr/0136-require-control-challenged-research-evidence.md)
- [ADR 0142](adr/0142-route-provider-credentials-through-a-bounded-egress-broker.md)
- [ADR 0143](adr/0143-continue-research-without-per-run-human-review.md)
- [wp2shellの実際のprompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)
- [Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)
- [公開Harnessの比較](knowledge/reference-harness-observability.md)
