状態: 調査完了（2026-10-08取得）。Issue #228向け。コード変更なし。openai.comとhelp.openai.comは403で本文を読めず、developers.openai.com、learn.chatgpt.com（Codex docsの移転先）、github.com/openai/codexで代替した。

# Sol / Luna のRuntimeProfile登録に必要な公式仕様

## 結論

1. **「Sol」は一つのモデルではない。** 2026-10-08時点で公式に存在するSolは`gpt-5.6-sol`（2026-07-09）、`gpt-6-sol`（2026-09-22）、`gpt-6.1-sol`（2026-09-29）の3つ。Codex CLI 0.161.0（2026-10-07）の既定は`gpt-6.1-sol`。同梱カタログでは`gpt-5.6-sol`を「Older generation workhorse model」とし、`gpt-6-sol`への移行を促す。Lunaも`gpt-5.6-luna`と`gpt-6-luna`の2つがある。**本番で使うSolとLunaの世代を人間が決める必要がある**。決めないとカタログ登録とベンチマークの固定ができない。
2. **Harnessが固定しているCodex CLI 0.146.0では、GPT-6系を使えない。** 同梱カタログの`minimal_client_version`は`gpt-6.1-sol`が0.153.0、`gpt-6-sol`と`gpt-6-luna`が0.155.0。GPT-6系を使うには`codexNativeTransport.executableVersion`とsandbox imageの更新が必要になる。transport requirementはtransportKindごとに一つなので、既存のDaybreakとLunaのprofileも同時にdigestが変わる（ADR 0141の代償どおり）。
3. **`gpt-5.6-sol`と`gpt-5.6-luna`は0.146.0のままでも登録できる。** どちらも`minimal_client_version`は0.144.0。0.146.0の同梱カタログで、Solのeffortは`low|medium|high|xhigh|max|ultra`、Lunaは`low|medium|high|xhigh|max`。Lunaは既に`gpt-5.6-luna`/`max`で登録済み。Solを足す変更はカタログの`admittedModels`へのtuple追加だけで済む。
4. **`gpt-daybreak-blue-latest`は、`gpt-5.6-sol`を指す非推奨のaliasである。** API docsは既定snapshotを`gpt-5.6-sol`とし、「This alias is deprecated」と書く。Daybreak Blue/Redは2026-08-07に導入されたアクセス階層（Trusted Access for Cyber）で、モデルではない。現在のAPIでは`access_programs.cyber`（`standard`/`daybreak_blue`/`daybreak_red`）で指定する。Codexでは0.161.0の`codex exec --cyber-access-program`で指定する。
5. **固定の弱点は「実際に応答したモデルを観測できないこと」である。** API docsは`-latest` aliasについて「inspect `model` to see which model served the request」「Alias resolution can change」と書く。一方、`codex exec --json`のイベント（`thread.started`、`turn.completed`、`item.*`）には`model`欄がない（`exec_events.rs`、0.146.0と0.161.0で確認）。どのモデルページにも日付付きsnapshot IDはない。ベンチマークの腕ごとには、要求したmodel ID、CLI版、同梱カタログのdigest、認証方式、cyber access program、service tier、サブエージェントのmodelとeffortを記録する必要がある。
6. **料金は、API価格よりCodexのクレジット消費で比較する。** $500 Proの消費は、API価格ではなくCodexのクレジット換算で効く。`gpt-6.1-sol`は入力/出力が50/250 credits per 1M tokens、`gpt-5.6-sol`は100/500で、6.1 Solは同じトークン数で半分の消費になる。Pro planに5時間制限はないが、週次上限があり、その数値は公開されていない。

## 証拠の境界

- **一次資料として読めたもの:** developers.openai.com（API models、changelog、Daybreak guide、Using GPT-6）、learn.chatgpt.com（`developers.openai.com/codex/*`から308でリダイレクトされるCodex公式docs）、github.com/openai/codexのrelease notesとソース（`codex-rs/models-manager/models.json`、`codex-rs/exec/src/exec_events.rs`、`codex-rs/features/src/lib.rs`、`codex-rs/protocol/src/protocol.rs`）。どれも2026-10-08に取得した。
- **403で読めなかったもの:** openai.com/index/*（GPT-5.6 Solのプレビュー記事、「Improving GPT‑5.6 Sol in ChatGPT」、Daybreak発表）とhelp.openai.com（Pro tiers、Daybreak troubleshooting、GPT-6 in ChatGPT）。検索結果の要約にあった次の記述は**未検証**として扱い、結論には使っていない。
  - 「8月のSol更新はChatだけで、Work/Codex版は変えない」
  - 「Daybreak BlueはCodexで`codex -m gpt-daybreak-blue-latest`を使える」
  - 「Pro $500はAstra Ultrafastを含む」（この点はlearn.chatgpt.com/docs/pricingで確認できた）
- **ページの日付:** developers.openai.comのモデルページとlearn.chatgpt.comには公開日・更新日がない。日付はAPI changelog、Codexのrelease（GitHubの`publishedAt`）、learn.chatgpt.comのchangelogの記載から取った。
- **同梱カタログの限界:** `models.json`はCLIに同梱される既定値である。ChatGPTでサインインした場合は、サーバー側のカタログで上書き・更新され得る（0.152.0「model picker refreshes available models」、0.160.0「Explicit provider model catalogs ...」）。0.146.0の同梱カタログには`gpt-daybreak-blue-latest`がない。Harnessでの既存Daybreak実行はリモートカタログ経由で動いていたと推定されるが、確認していない。
- **一次資料ではない情報:** コミュニティフォーラムとGitHub上の他社Issue（例: Daybreak aliasがChatGPT認証で400になる #39441、Lunaが`/model`に出ない #47152）は一次資料の外とし、参考として触れるだけに留めた。
- **確認しなかったもの:** 実行は行っていない（Codex CLIの起動、APIの呼び出し、Pro planの残量確認）。

## 現在のHarness（ソース確認）

| 項目 | 場所 | 現状 |
| --- | --- | --- |
| Profile schema | `src/infrastructure/agent-runtime-profile.ts` | `kind`、`schemaVersion: 1`、`id`、`transportKind`、`executableVersion`、`sandboxImageDigest`、`promptProtocol`、`reportProtocol`、`model`、`effort`、`digest`（本体のcanonical digest） |
| Codex transport | 同上 `codexNativeTransport` | `codex-native/v1`、`executableVersion: "0.146.0"`、image `sha256:44342fc7…5a73`、`stdin`、`schema-constrained-json` |
| Codexでadmit済みのmodel/effort | 同上 `admittedModels` | `gpt-daybreak-blue-latest` × `high`/`xhigh`/`max`、`gpt-5.6-luna` × `max` |
| 他transportのadmit済みmodel | 同上 | `grok-4.6`/`xhigh`、`claude-opus-5`/`high`、`glm-5.3`/`max`、`deepseek-flash`/`max` |
| CLIへの受け渡し | `src/research/agent-led/codex-native-agent-runtime.ts` 434–479行 | `codex exec --model <profile.model> --sandbox read-only --skip-git-repo-check --ignore-user-config --ignore-rules --disable shell_tool --disable unified_exec --disable skill_mcp_dependency_install -c model_reasoning_effort="<profile.effort>" -c features.multi_agent=true -c agents.enabled=true -c agents.max_concurrent_threads_per_session=3 ... --output-schema ... --json` |
| モデルIDが固定されている箇所 | `admittedModels`（本体）、テスト`tests/infrastructure/agent-runtime-profile.test.ts`、`tests/research/codex-native-agent-runtime.test.ts`、`tests/operations/campaign-exploration-volume*.test.ts` | adapterとCLIにはmodel文字列を直接書いていない。ADR 0141どおり、カタログだけが所有する |
| 応答したモデルの照合 | Codex adapter | **行っていない。** Claude adapterはReceiptのcanonical modelと照合する（CODEBASE-GUIDE 247行）。Codexにはイベント側の照合元がない |
| サブエージェントのmodel/effort | Codex adapter | 指定していない（`agents.default_subagent_model`と`agents.default_subagent_reasoning_effort`を渡していない） |
| service tier、cyber access program、認証方式 | — | profileにもCLI引数にもない |

## 比較表（モデル仕様）

APIの値はdevelopers.openai.comのモデルページ、Codexの値はgithub.com/openai/codexの同梱`models.json`（`rust-v0.161.0`、括弧内は`rust-v0.146.0`）から取った。

| 項目 | `gpt-5.6-sol` | `gpt-6-sol` | `gpt-6.1-sol` | `gpt-5.6-luna` | `gpt-6-luna` | `gpt-daybreak-blue-latest` |
| --- | --- | --- | --- | --- | --- | --- |
| 公開日（API changelog） | 2026-07-09 | 2026-09-22 | 2026-09-29 | 2026-07-09 | 2026-09-22 | 2026-08-07（Daybreak階層の導入日） |
| Codexでの追加 | 0.144.0（2026-07-09） | 0.156.1 / 0.157.0（09-23 / 09-25） | 0.159.1で既定化（09-29）、0.161.0で既定（10-07） | 0.144.0 | 0.156.1 / 0.157.0 | 同梱カタログでは`visibility: hide`（0.161.0）、0.146.0には記載なし |
| alias / snapshot | alias `gpt-5.6`がこのモデルを指す。snapshotは`gpt-5.6-sol`だけ | snapshotは`gpt-6-sol`だけ | snapshotは`gpt-6.1-sol`だけ | snapshotは`gpt-5.6-luna`だけ | snapshotは`gpt-6-luna`だけ | alias。既定snapshotは`gpt-5.6-sol`。**deprecated** |
| knowledge cutoff | 2026-02-16 | 2026-04-20 | 2026-04-30 | 2026-02-16 | 2026-05-18 | 2026-02-16 |
| API context / max input / max output | 1,050,000 / 922,000 / 128,000 | 同左 | 同左 | 同左 | 同左 | 同左 |
| Codexの`context_window` / `max_context_window` | 272,000 / 872,000（0.146.0: 272,000 / 272,000） | 272,000 / 872,000 | 272,000 / 872,000 | 272,000 / 872,000（0.146.0: 272,000 / 272,000） | 272,000 / 872,000 | 272,000 / 872,000 |
| APIのeffort | none, low, medium（既定）, high, xhigh, max | none〜max | low〜max（none / minimal不可） | none〜max | none〜max | 記載なし |
| Codexのeffort（同梱カタログ） | low, medium, high, xhigh, max, ultra（既定low） | low〜ultra（既定medium） | low〜ultra（既定low） | low〜max（ultraなし、既定medium） | low〜max（ultraなし、既定medium） | low〜ultra（既定low） |
| Structured Outputs（API） | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 |
| API価格 入力/キャッシュ/出力（per 1M） | $4 / $0.40 / $20（販促価格、少なくとも2026-11-21まで） | $2 / $0.20 / $10 | $2 / $0.10 / $10（cache write $2.50） | $0.20 / $0.02 / $1.20 | $0.10 / $0.01 / $0.50 | 記載なし |
| Codex credits 入力/キャッシュ/出力（per 1M、Standard） | 100 / 10 / 500 | 50 / 5 / 250 | 50 / 2.5 / 250 | 5 / 0.5 / 30 | 2.5 / 0.25 / 12.5 | 記載なし |
| Codexの`minimal_client_version` | 0.144.0 | 0.155.0 | 0.153.0 | 0.144.0 | 0.155.0 | 0.142.2 |
| Codexの`multi_agent_version` | v2 | v2 | v2（`multi_agent_reasoning_effort: xhigh`） | **v1** | v2 | v2 |
| Codexの`default_service_tier` | null | **`priority`（Fast）** | null | null | **`priority`（Fast）** | null |
| Codexでの扱い（0.161.0） | `upgrade → gpt-6-sol`、`retirement_at: null` | 現行（Previous generation） | 既定・推奨 | `upgrade → gpt-6-luna`、`retirement_at: null` | 現行 | `model_specialty: "cyber"` |

補足:

- **Codexのcontext window:** 0.144.6で、GPT-5.6系のcontext windowを272,000へ訂正した（#33972、#34009）。0.149.0で上限を引き上げた（#39102 「Raise the GPT-5.6 maximum context window」）。CodexではAPIの1.05Mではなく、272Kが通常の窓になる。
- **Codexのeffort `ultra`:** Codex固有の段階で、「Ultra uses subagents to split a task across parallel parts」（learn.chatgpt.com/docs/models）。0.144.0には、Ultraを選ぶと多重並列で消費が急増する旨の警告が入った（#31621）。Harnessのルート込み最大4体の上限と衝突し得るため、admitするかは別に判断する必要がある。
- **`gpt-5.6-luna`はmulti-agent v1:** 0.161.0のexec JSONLは、v1とv2の協調ツールを`spawn_agent`、`send_input`、`wait`、`close_agent`の4種へ正規化している（`event_processor_with_jsonl_output.rs`）。Harnessのparserが受け付ける集合と型の上では一致する。v1モデルでの実際のサブエージェント起動は、実行して確認していない。
- **Pro planの利用上限:** learn.chatgpt.com/docs/pricingによると、Proは$100/$200/$500の3段で、「Pro plans currently have no five-hour limit」。$500はAstra Ultrafastを含む。Pro向けのモデル別の数値は公開されていない。Plus / Business Standardの5時間あたりlocal messages目安は、GPT-6.1 Solが15–160、GPT-6 Solが15–150、GPT-6 Lunaが350–3,000。GPT-5.6系はこの表に載っていない。Fastは含まれる利用量を2.5倍消費する。
- **APIキーでのCodex利用:** API価格で課金され、利用できるモデルはそのキーのAPIモデルに従う（同ページ）。

## Codex CLIの現状（0.146.0 → 0.161.0）

| 項目 | 現状（一次資料） | Harnessへの影響 |
| --- | --- | --- |
| 最新版 | stable `0.161.0`（2026-10-07）。プレリリースは`0.162.0-alpha.*` | 固定版は0.146.0（2026-07-29）。15版遅れている |
| モデル指定 | `codex exec -m/--model <id>`、または`config.toml`の`model`。learn.chatgpt.comの例は`codex exec -m gpt-6.1-sol "..."` | 現行の渡し方のまま使える |
| reasoning effort | `config.toml`の`model_reasoning_effort`で、例は`low`、`medium`、`high`、`xhigh`、`max`、`ultra`。「Available levels depend on the model and client」。0.149.0でSDKから`max`/`ultra`を選べるようになった（#38817、#39662）。0.158.0で「Allow reasoning shortcuts to reach Max」（#48116） | `-c model_reasoning_effort="..."`はそのまま使える |
| サブエージェントのmodel/effort | `agents.default_subagent_model`と`agents.default_subagent_reasoning_effort`（spawn時の明示指定が優先）。同梱カタログの`multi_agent_reasoning_effort`は`gpt-6.1-sol`と`gpt-6-astra`が`xhigh` | **Harnessは未指定。** ルートと子が別のmodel/effortで動く可能性があり、腕の固定が崩れる |
| 並列数 | `agents.max_concurrent_threads_per_session`は、primaryを除く同時thread数（config reference） | 現行の`3`は、ルート込み4体の意味と一致する |
| multi-agent | `features.multi_agent`は既定でon。0.145.0でmulti-agent V2が安定化し、子のmodel・effort・並列数を設定できるようになった | — |
| JSON出力 | `codex exec --json`（別名`--experimental-json`）はNDJSONのイベント列 | イベントに`model`欄はない |
| structured output | `codex exec --output-schema <path>`はJSON Schemaファイルを受け取る。`-o/--output-last-message`もある | 現行の使い方のまま |
| `--dangerously-bypass-approvals-and-sandbox` | 別名`--yolo`。「Only use inside an externally hardened environment」 | Harnessは使っていない（`--sandbox read-only`）。変更は不要 |
| `--full-auto` | 0.147.0で`codex exec --full-auto`を削除。代わりは`--sandbox workspace-write`（#36054） | Harnessは使っていない |
| sandbox | `--sandbox read-only|workspace-write|danger-full-access`。0.148.0で、拒否・読取不能パスについてLinux/Windowsとも失敗時閉鎖（fail closed）にした | 影響なし |
| feature名 | 0.161.0の`features/src/lib.rs`に`shell_tool`、`unified_exec`、`skill_mcp_dependency_install`、`multi_agent`、`apps`、`memories`、`plugins`、`browser_use`、`computer_use`、`remote_plugin`、`workspace_dependencies`が残っている | 現行の`--disable`と`requirements.toml`はそのまま使える |
| Daybreak | 0.161.0で`--enable cli_daybreak`または`features.cli_daybreak=true`による opt-in になった（`stage: UnderDevelopment`、既定はoff）。`codex exec --cyber-access-program`はターンごとの指定で、`cli_daybreak`が無効でも使える（#49856、#49939、#51207）。0.161.0はOpenAI APIキーでの明示的なcyber access programにも対応した（#49406） | 0.146.0には存在しない |
| GPT-6系 | 0.153.1でAstraの設定に対応、0.156.1/0.157.0でGPT-6 Sol/Lunaを追加、0.159.1/0.161.0でGPT-6.1 Solを既定にした | GPT-6系を使うにはCLI更新が必須 |
| 退役 | GPT-5.5は2026-10-14にChatGPT/Work/Codexから退役（APIには残る）。GPT-5.6 Sol/Terra/Lunaは「remain available during the rollout」 | GPT-5.6には退役日の告知がまだない |

## Daybreakの位置づけ

- **アクセス階層であり、モデルではない:** Daybreakは「Trusted Access for Cyber」のアクセス階層である（API changelog 2026-08-07: 「Daybreak Blue and Daybreak Red access tiers introduced. Red uses GPT-5.6 Cyber」）。
- **`gpt-daybreak-blue-latest`:** 「An alias for flagship general-purpose models with safeguards for defensive cybersecurity work」で、既定snapshotは`gpt-5.6-sol`。ページには「This alias is deprecated, please use the latest cyber model available to you」とある。
- **PR #215で追加した「Daybreak Blue high」の中身:** 実体は`gpt-5.6-sol`にDaybreak Blueの安全策を付けたものである。aliasなので、指す先が変わり得る。
- **API上の現行方式:** Daybreak guideによると、`access_programs.cyber`で`standard`/`daybreak_blue`/`daybreak_red`を選ぶ。
  - `gpt-6-sol`は`daybreak_blue`を受け付ける。
  - `gpt-6.1-sol`と`gpt-6-astra`は、`daybreak_blue`でreduced refusalsになる。ただし「Requires Daybreak Red approval for your organization」。
  - `gpt-5.6-cyber`は`daybreak_red`だけを受け付ける。
  - `gpt-5.6-sol`と`gpt-daybreak-blue-latest`はguideに記載がない。
- **`gpt-5.6-cyber`:** context 400,000、max input 272,000、出力128,000、cutoffは2026-02-16。価格は$12.50 / $1.25 / $75。Red承認が必要。
- **Codex:** 0.161.0以降は、`--cyber-access-program`でmodelとcyber access programを別々に指定できる。aliasに頼らず「`gpt-6.1-sol` + `daybreak_blue`」のように組み合わせて固定できる。ただし、組み合わせごとにアカウント承認の条件が異なる。

## build / snapshotの固定

公式の扱い:

- **OpenAIの一般原則:** 各モデルページにある定型文は「Snapshots let you lock in a specific version of the model so that performance and behavior remain consistent」。`chat-latest`のような`-latest`系は「regularly updated」とされる。
- **Sol / Luna / Daybreakの現状:** **どのページも、日付付きsnapshot IDを列挙していない**。snapshotは素のIDだけで、`gpt-5.6-sol`、`gpt-6-sol`、`gpt-6.1-sol`、`gpt-5.6-luna`、`gpt-6-luna`のいずれも同じ。素のIDが将来も同じ重みを指すという明示の保証も、見つからなかった。
- **alias:** `gpt-5.6`は`gpt-5.6-sol`を指す。`gpt-daybreak-blue-latest`は`gpt-5.6-sol`を指す非推奨のalias。API docsは「For a `-latest` alias, inspect `model` to see which model served the request. Alias resolution can change」と書く。
- **Codexの同梱カタログ:** 各モデルに`comp_hash`（例 `"3000"`）、`minimal_client_version`、`upgrade`、`retirement_at`がある。同じslugでも、CLI版によって`max_context_window`、effortの段階、`default_service_tier`、システム指示（`base_instructions` / `model_messages`）が変わる。例えば0.144.6でGPT-5.6の指示を更新し、0.157.0で`gpt-5.6-sol`から`ultrafast` tierを削除した。**同じmodel IDでも、CLI版が違えば実行条件が違う。**
- **観測できる範囲:** `codex exec --json`には応答したモデルが出ない。Codexのrollout（`TurnContextItem`）には`model`、`effort`、`cyber_access_program`が、`SessionMeta`には`cli_version`と`model_provider`が記録される（`protocol.rs`、0.161.0）。ただし、これはクライアント側が要求した値で、サーバーが解決したsnapshotではない。

ベンチマークの腕ごとに記録すべき値:

| 記録項目 | 理由 | 取得元 |
| --- | --- | --- |
| 要求したmodel ID（aliasは避け、素のsnapshot ID） | aliasは解決先が変わる | profile |
| reasoning effort | 段階はmodelとCLI版に依存する | profile |
| Codex CLIのexact版 | 同梱カタログ、指示、effortの段階が版ごとに変わる | profile `executableVersion` |
| sandbox image digest | CLIバイナリを固定するため | profile |
| 同梱カタログの該当エントリのdigest（slug、`comp_hash`、effortの段階、context window、`default_service_tier`、`multi_agent_version`） | 同じslugでも中身が変わる | `models.json`。Harness側で算出する |
| 認証方式（ChatGPT sign-in / API key）とplan | 利用できるモデル、課金、リモートカタログが変わる | 実行環境 |
| cyber access program（`standard`/`daybreak_blue`/`daybreak_red`） | 拒否率が変わる | CLI引数（0.161.0以降） |
| service tier（Standard / Fast） | GPT-6 Sol/Lunaは既定が`priority`で、消費が2.5倍になる | config。キー名は要確認 |
| サブエージェントのmodelとeffort | 未指定だと、子が別条件で動く | `agents.default_subagent_*` |
| 実行日時（UTC） | サーバー側の変更と突き合わせるため | Receipt |
| rolloutの`TurnContextItem.model`、`effort`、`cli_version` | クライアントが実際に送った値の証跡 | `CODEX_HOME/sessions`。取得方法は要設計 |

## 現在のカタログに不足しているフィールド

| 不足 | 必要な理由 | 根拠 |
| --- | --- | --- |
| cyber access program | Daybreakはmodelではなくrequest属性に移った。aliasは非推奨 | Daybreak guide、0.161.0 release |
| service tier | `gpt-6-sol`/`gpt-6-luna`はCodexの既定が`priority`（Fast）で、消費が2.5倍になる | `models.json` 0.161.0、learn.chatgpt.com/docs/pricing |
| サブエージェントのmodel / effort | 子のeffortは既定で`xhigh`になり得る（6.1 Sol）。ルートと同一条件にすることを保証できない | config reference、`models.json` |
| 認証方式 | ChatGPT sign-inとAPI keyでは、利用できるモデル、価格、カタログが異なる | learn.chatgpt.com/docs/pricing |
| カタログエントリのdigest | 同じslugでもCLI版で指示とcontextが変わる | release notes 0.144.6、0.149.0、0.157.0 |
| 応答したモデルの照合手段 | Codex JSONLに`model`欄がない | `exec_events.rs` |
| effort `ultra`の扱い | サブエージェントを使う段階で、ルート込み4体の上限と干渉し得る | learn.chatgpt.com/docs/models、0.144.0 release |

注: `effort`はschema上`z.string()`で、値の制約はカタログのtupleだけが担う。この方式で困る点はない。

## 登録に必要な値の一覧

各行は`admittedModels`に追加する一つの`{ transportKind, model, effort }` tupleを表す。`id`はHarness側の命名なので空欄にした。

| 候補 | `transportKind` | `model` | `effort`候補（Codexで有効な値） | 必要な`executableVersion`（最小） | 現行0.146.0で動くか | 追加で固定すべき値 | 未確定・要判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GPT-5.6 Sol | `codex-native/v1` | `gpt-5.6-sol` | `low`, `medium`, `high`, `xhigh`, `max`（`ultra`は保留） | 0.144.0 | 動く（同梱カタログに記載あり、v2） | subagent model / effort、service tier（既定null=Standard） | Codex上の後継は`gpt-6-sol`。退役日は未告知 |
| GPT-6.1 Sol | `codex-native/v1` | `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh`, `max`（`ultra`は保留） | 0.153.0（現行の既定は0.161.0） | **動かない**。CLIとimageの更新が必要 | subagent effort（カタログ既定`xhigh`）、service tier | Daybreak Blueのreduced refusalsにはRed承認が必要（API） |
| GPT-6 Sol | `codex-native/v1` | `gpt-6-sol` | `low`〜`max`（`ultra`は保留） | 0.155.0 | **動かない** | service tier（既定`priority`=Fastなので明示的に固定する） | — |
| GPT-5.6 Luna（登録済み） | `codex-native/v1` | `gpt-5.6-luna` | `low`, `medium`, `high`, `xhigh`, `max`（`ultra`なし） | 0.144.0 | 動く（登録済み: `max`） | multi-agent v1での子の挙動 | Codex上の後継は`gpt-6-luna` |
| GPT-6 Luna | `codex-native/v1` | `gpt-6-luna` | `low`, `medium`, `high`, `xhigh`, `max`（`ultra`なし） | 0.155.0 | **動かない** | service tier（既定`priority`） | — |
| Daybreak Blue（登録済み） | `codex-native/v1` | `gpt-daybreak-blue-latest` | `low`〜`max`（登録済み: `high`/`xhigh`/`max`） | 0.142.2 | 動作実績あり（0.146.0の同梱カタログには記載なし） | — | **deprecated alias**（実体は`gpt-5.6-sol`）。0.161.0以降は`model` + `--cyber-access-program daybreak_blue`への置換を検討する |

全行に共通して、Harness側で決める値と確認が要る点:

- **Harness側で決める値:** `id`、`sandboxImageDigest`（CLIを更新するなら新しいimageを作る）、`promptProtocol: "stdin"`、`reportProtocol: "schema-constrained-json"`。最後の二つは0.161.0でも`--output-schema`と`--json`が残っているので、変更不要と判断した。
- **CLIを0.161.0へ上げる場合:** `codexNativeTransport.executableVersion`と`sandboxImageDigest`が変わり、既存のCodex profileのdigestがすべて変わる。また、`--cyber-access-program`、`agents.default_subagent_model`、`agents.default_subagent_reasoning_effort`、service tierをprofileのフィールドにするかを決める必要がある。
- **service tierの設定キー:** service tierを固定する`config.toml`のキー名（`service_tier`など）は、config referenceの先頭100,000文字の範囲では確認できなかった。

## 出典（すべて2026-10-08取得）

| 資料 | URL | 日付 |
| --- | --- | --- |
| GPT-5.6 Sol model page | https://developers.openai.com/api/docs/models/gpt-5.6-sol | 公開日の記載なし（changelogでは2026-07-09公開、2026-08-21に値下げ） |
| GPT-5.6 Luna model page | https://developers.openai.com/api/docs/models/gpt-5.6-luna | 同上（2026-07-09公開、2026-07-30に値下げ） |
| GPT-6 Sol model page | https://developers.openai.com/api/docs/models/gpt-6-sol | changelogでは2026-09-22 |
| GPT-6.1 Sol model page | https://developers.openai.com/api/docs/models/gpt-6.1-sol | changelogでは2026-09-29 |
| GPT-6 Luna model page | https://developers.openai.com/api/docs/models/gpt-6-luna | changelogでは2026-09-22 |
| Daybreak Blue model page | https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest | changelogでは2026-08-07 |
| GPT-5.6 Cyber model page | https://developers.openai.com/api/docs/models/gpt-5.6-cyber | 記載なし |
| API changelog | https://developers.openai.com/api/docs/changelog | 項目ごとの日付（最新は2026-10-07） |
| Use Daybreak in the Responses API | https://developers.openai.com/api/docs/guides/daybreak | 記載なし |
| Using GPT-6 | https://developers.openai.com/api/docs/guides/latest-model | 記載なし |
| Models overview | https://developers.openai.com/api/docs/models | 記載なし |
| Codex Models（`developers.openai.com/codex/models`から308でリダイレクト） | https://learn.chatgpt.com/docs/models | 記載なし |
| Codex CLI reference | https://learn.chatgpt.com/docs/cli/reference | 記載なし |
| Codex config reference（`developers.openai.com/codex/config-reference`から308でリダイレクト） | https://learn.chatgpt.com/docs/config-file/config-reference | 記載なし。先頭100,000文字だけ確認 |
| Codex Pricing | https://learn.chatgpt.com/docs/pricing | 記載なし（GPT-5.5退役日2026-10-14への言及あり） |
| ChatGPT & Codex changelog | https://learn.chatgpt.com/docs/changelog | 項目ごとの日付（2026-09-22〜2026-10-07を確認） |
| Codex releases 0.144.0〜0.161.0 | https://github.com/openai/codex/releases （例: https://github.com/openai/codex/releases/tag/rust-v0.161.0） | 0.161.0は2026-10-07、0.146.0は2026-07-29、その他はrelease本文に記載 |
| 同梱model catalog | https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/models-manager/models.json と https://github.com/openai/codex/blob/rust-v0.146.0/codex-rs/models-manager/models.json | tagの日付 |
| exec JSONL event定義 | https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/exec/src/exec_events.rs | 同上 |
| feature flag定義 | https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/features/src/lib.rs | 同上 |
| rollout protocol | https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/protocol/src/protocol.rs | 同上 |
| 403で読めなかった資料 | https://openai.com/index/previewing-gpt-5-6-sol/ 、 https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt 、 https://help-lb.openai.com/en/articles/20001259-openai-daybreak-common-issues-and-troubleshooting | 本文は未取得 |
