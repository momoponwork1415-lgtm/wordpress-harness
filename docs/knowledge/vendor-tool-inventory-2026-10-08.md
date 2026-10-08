# 調査資料: 大手公開ツールの棚卸し（WordPressプラグイン・バグバウンティHarnessへの適用可否）

状態: 一次資料に基づく棚卸し（GitHub Issue #239）。取得日は2026-10-08。固定commitは各repositoryを2026-10-08に取得した時点のもの。openai.comとhelp.openai.comはHTTP 403で取得できなかったため、OpenAIの記述は公式docs（`learn.chatgpt.com/docs/security`）、公式GitHub、GitHub Releasesで代替した。既存note（[参考ハーネスの比較](reference-harness-observability.md)と`research/design-references`ブランチの`pipeline-reference-designs-2026-10-08.md`）にある事実は繰り返さない。

## 結論

1. **そのまま使えるのは「部品」だけで、Harnessの土台になるものはない。** 4ツールとも「自分のrepositoryを診るスキャナ」として作られている。第三者のプラグインsourceをスキャンすること自体はできる。しかし、WordPress Lab、種別別canary判定器、Programme Boundaryとscope評価、既知脆弱性を渡さない評価、Wordfence / Patchstackへの提出フローは、どのツールの機能一覧にもない。この5つは自作になる（[自作が避けられない部分の一覧](#自作が避けられない部分の一覧)）。
2. **そのまま使える主要項目は3つある。**
   - Codex SecurityのSARIF export（lossyなexportと明記されている）
   - Codex Securityの`findings.json` / `coverage.json` / `scan-manifest.json`を、digestで参照する不透明な添付物として保存すること
   - Mantisの「Tier 3（隔離した全service）だけが`reproduced`」「setup失敗は`failed`にしない」と、Cloudflareの「sandbox制御が欠けたら実行せず`needs_validation`」という判定規則の文面
3. **自前の実行環境をvalidationへ接続する公式の口は、Codex Securityの「custom validation」だけである。** `--validation-prompt-file` / SDK `validationPrompt` / project fileの`scan.validation_file`がそれにあたる。ただし次の4点が本repositoryの不変条件と衝突するため、「改造が必要」に分類する。
   - Discoveryの直後に自動で走り、人間の候補採否より前に来る。
   - 判定するのはLLMであり、決定論的なcanary判定器ではない。
   - validation agentがLab起動の権限を持つことになる。
   - Deep scanと併用できない。
4. **既知脆弱性の自動取り込みは、ツールごとに扱いが違う。**
   - Codex Securityは、advisory seed passを利用者がCVEやadvisoryを与えたときだけ起動する。core scanは「other revisions or Git history」を読まない。
   - Anthropic reference harnessの`/threat-model bootstrap`は、git historyとGitHub advisoryを自動で採掘する。無効化するflagはない。
   - Mantisは`mantis-history`を実行しなければ取り込まない。
   - 前回scanの偽陽性判断を持ち越す機能（Codex）と、前pass結果と照合する機能（Mantis dedupe）は、新しいstate directoryを使えば無効化できる。
5. **Claude Security pluginはproductionの探索に使えない。** licenseがproprietaryで、「solely with Claude Code or other Anthropic products」に限られる。本番の探索modelはSol（Codex CLI）なので、開発時にClaude Code上で比較する用途に限られる。

## 証拠の境界

- **Observed:** 下表の固定commit、公式docs、公式Releasesで確認した事実。
- **Inference:** このrepositoryへの判断。採用決定ではない。
- **未確認:** 一次資料で確認できなかった事項。spikeで確かめるまで前提にしない。

| 対象 | 一次資料（版・日付） | 限界 |
| --- | --- | --- |
| OpenAI Codex Security（CLI / SDK / plugin） | [`openai/codex-security@5ebe48db`](https://github.com/openai/codex-security/tree/5ebe48db0585c5e582b0494236a01a739af13709)（commit 2026-10-08）。npm `@openai/codex-security` 0.2.0（[Release](https://github.com/openai/codex-security/releases/tag/npm-v0.2.0) 2026-10-06）。repository内のplugin manifestは0.1.95。docs: [Overview](https://learn.chatgpt.com/docs/security)、[CLI](https://learn.chatgpt.com/docs/security/cli)、[CLI FAQ](https://learn.chatgpt.com/docs/security/cli/faq)、[Cloud FAQ](https://learn.chatgpt.com/docs/security/faq)、[Cloud setup](https://learn.chatgpt.com/docs/security/setup)、[Plugin changelog](https://learn.chatgpt.com/docs/security/plugin/changelog)（docsに日付はなく、取得日は2026-10-08。changelogの最新は0.1.30 / 2026-09-24で、npm版より古い） | 既存noteの固定点`c8296885f`から更新した。ChatGPTのどのplanで利用できるかは、docsで確認できなかった。 |
| Anthropic Claude Security plugin | [docs](https://code.claude.com/docs/en/claude-security)（取得日2026-10-08）、[`anthropics/claude-plugins-official@b78ac49c`](https://github.com/anthropics/claude-plugins-official/tree/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security)（plugin 0.12.0。plugin配下の最終変更は2026-09-25の`ca08d5e`）、[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | 実際にscanを実行しての評価はしていない。 |
| Anthropic defending-code-reference-harness | [`d3bea6b5`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145)（2026-08-06、保守終了） | 既存noteと同じ固定点。 |
| Google Mantis | [`2b3bbdcb`](https://github.com/google/mantis/tree/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80)（2026-10-06） | skill本文だけを見る。ADK harnessは評価しない。 |
| Cloudflare security-audit-skill | [`c1c8a8c1`](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8)（2026-09-14） | 既存noteと同じ固定点。既存noteの採用判断は繰り返さない。 |

## ツール別の分類表

分類の意味は次のとおり。

- **そのまま:** 変更なしで使える。
- **設定:** 公式の設定、flag、SDK optionで使える。
- **改造:** 本文やコードを書き換える必要がある。
- **使えない:** 本repositoryの不変条件またはlicenseと衝突する。

### 1. OpenAI Codex Security

| 項目 | 分類 | Observed（根拠） | 本repositoryでの意味（Inference） |
| --- | --- | --- | --- |
| 第三者pluginの読み取り専用snapshotを対象にする | **設定**（要spike） | 非Gitのdirectoryは`directory_snapshot`として扱い、`snapshotDigest`を記録する（[scan-contract.md L53-64](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/references/scan-contract.md#L53-L64)）。inventoryは`rg --files`で作り、`.git`がなくても動く（[generate_in_scope_files.py L88-L135](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/scripts/generate_in_scope_files.py#L88-L135)）。出力directoryは対象の外に置き、空にする必要がある。docsは「repositories you own or have permission to assess」と書く（[SDK README L89](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/README.md#L89)） | Programmeの許可範囲内であれば、第三者のsnapshotも対象にできる。ただし次項の権限があるため、gVisor容器の中で丸ごと動かす前提になる。 |
| 実行境界 | **設定**（要spike） | scan用permission profileは`":root": "read"`、`":workspace_roots": "write"`である（[api.ts L4590-L4602](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/api.ts#L4590-L4602)）。READMEは「runs with your operating-system permissions」と明記する（[README L460-](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/README.md#L460)）。Linuxでの制限付き実行にはBubblewrapが必須で、Landlockへのfallbackは廃止された（[docker/README L226-L235](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/docker/README.md#L226-L235)）。`--external-sandbox`は`patch`だけが持つ（[cli.md L1288-L1297](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/docs/cli.md#L1288-L1297)） | host全体が読み取り可能なので、Agent Sandbox（gVisor）の中で実行する。**gVisorの中でBubblewrapのnested user namespaceが動くかは未確認。**動かない場合でも、scanには外部sandboxへ切り替える公式の口がない。 |
| PHP / WordPressへの対応 | **そのまま** | Cloud FAQは「Codex Security is language-agnostic」と書く。0.2.0でPHTMLなどのserver-rendered templateがinventoryに追加された（[Release](https://github.com/openai/codex-security/releases/tag/npm-v0.2.0)）。preview生成は「regardless of language」（[rank_preview.py](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/scripts/rank_preview.py)）。PHP固有の記述は、triage評価のdataset以外にはない | PHPを対象にすること自体は塞がれていない。WordPressに固有の知識（nonce、capability、REST、`admin-ajax`）は、model任せかscan instructionで与えることになる。 |
| Threat model（生成と独立architecture review） | **設定** | 生成するmodelは6つのfield（`summary`、`assets`、`trustBoundaries`、`attackerCapabilities`、`securityObjectives`、`assumptions`）を持つ。architecture reviewは`fork_turns: "none"`の別agentが行う。利用者が与えたmodelは「unchanged」で保持され、knowledge baseは生成した仮定より優先される（[threat-model.md](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/references/threat-model.md)）。0.2.0からthreat modelはscan結果と一緒に保存され、`export --artifact threat-model`で取り出せる | Programme Research Boundary由来の信頼前提は、`knowledgeBasePaths`または与えるmodelで渡せる。対象pluginに同梱された`SECURITY.md`もpolicyとして読まれる点に注意する（[core-scan.md L9](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/references/core-scan.md#L9)）。 |
| Scan phases（standard） | **使えない**（Research本体として） / **設定**（比較方式として） | core scanは「baseline subagent → threat model → investigation packet → investigator → 各候補の独立validation → 組み立て」の順序を持つ（[core-scan.md](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/references/core-scan.md)） | 固定の段階はRootの裁量と衝突する（AGENTS.md「探索役の数、役割、段階…を実装しない」）。既存の`cloudflare-upstream`と同じく、upstream比較方式としてなら保持できる。 |
| 同時実行数 | **設定** | 既定のmodelは`gpt-5.6-sol` / `xhigh`である。Multi-agent v2の既定は9 threadで、`--codex features.multi_agent_v2.max_concurrent_threads_per_session=4`で下げられる（[cli.md L490-L500](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/docs/cli.md#L490-L500)）。Deep scanのworker数とsubagent数は別の設定である（[project-configuration.md](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/docs/project-configuration.md)） | Root込み最大4体の上限は、thread上限とdeep worker数の両方を設定して守る。model既定はSol方針と一致する。 |
| 標準のvalidation | **使えない**（Verified Vulnerabilityの根拠として） | 実行できるときは動的に再現する。できなければ静的な追跡に落とし、「Missing internal runtime setup is not suppression evidence」とする（[validation SKILL](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/skills/validation/SKILL.md)）。SDKの`validate()`は`reportable`が「can rely on static analysis」と明記する（[README L330-](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/README.md#L330)） | AGENTS.mdは、静的な自己確認から`Verified Vulnerability`を作ることを禁じる。Researchの参考証拠に留める。 |
| Custom validation（自前Labへの接続口） | **改造** | 詳細は下の「Custom validation hookの事実」を参照。 | 公式の口として最も近い。人間ゲートの順序、判定主体、権限、deep非対応の4点で改造が要る。 |
| `findings.json` / `coverage.json` / `scan-manifest.json` | **そのまま**（添付物として） / **使えない**（記録契約の正本として） | 3つとも`documentType`と`schemaVersion: "1.0"`を持つ（[schemas](https://github.com/openai/codex-security/tree/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/schemas)）。中身は下の「Codex記録契約の事実」を参照。 | provider artifactとしてdigestで参照し、Research Recordへ添付する用途なら変更は要らない。正本にしない理由は2つある。findingの中にvalidationの状態が混在すること、そしてProgramme scope、Candidate Review、`runtime-confirmed` / `contradicted` / `incomplete`の区別を持たないことである（AGENTS.md「版付きの判別可能なユニオン」）。 |
| SARIF | **そのまま**（export用途） | 「SARIF is a deterministic export, not the Codex Security source of truth」。lifecycle、validation、coverageは「lossy or omitted」と明記されている。`executionSuccessful`は網羅性を示さない（[sarif-adapter.md](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/references/sarif-adapter.md)） | 外部viewerに見せる派生表示に限る。 |
| False-positive feedback | **設定**（無効化） | workbench DBの判断を、各scanの`artifacts/01_context/false_positive_feedback.json`へ書き出し、validationとcustom validationの両方に渡す（[api.ts L1858-L1880](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/api.ts#L1858-L1880)、[custom-validation.ts L319](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/custom-validation.ts#L319)）。保存先は`$CODEX_SECURITY_STATE_DIR/workbench.sqlite3` | 独立試行に過去の判断を持ち込まないよう、Campaignごとに新しい`CODEX_SECURITY_STATE_DIR`を使う。 |
| 前回findingとの照合 | **設定**（無効化） | scan完了後に前回のfindingと照合し、結果を`repositoryFindings`へ入れる（[api.ts L2266-L2316](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/api.ts#L2266-L2316)）。discoveryの入力にはならない | Campaignをまたいだdedupを自動化しない方針と衝突する。新しいstate directoryを使えば無効になる。 |
| 既知脆弱性の取り込み | **設定**（与えなければ起動しない） | advisory seed passは、利用者の依頼やcontextにCVE / GHSA / advisoryなどが含まれる場合だけ動く。外部の情報源は利用者が明示的に許可したときだけ使い、「do not inspect unrelated Git history or later fixes」とする（[scan-artifacts-and-ledger.md L12-L19](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/skills/security-scan/references/scan-artifacts-and-ledger.md#L12-L19)）。core scanは「inspect only its authorized current state rather than other revisions or Git history」と書く | knowledge base、scan instruction、threat modelに既知脆弱性を入れなければ、oracle-freeを保てる。入れていないことはHarness側で保証する。 |
| Deep scan | **設定**（ただしcustom validationとは併用不可） | 「Deep diff scans and custom validation remain unsupported」（[project-configuration.md L246](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/docs/project-configuration.md#L246)） | deepの広い探索と自前Labでの検証は、同じscanの中では組み合わせられない。 |
| `patch` / `verify-fix` / `scan --patch` | **使えない** | patchを作成し、`--create-pr`でPRを作る | 修正は製品の範囲外である。PR作成は外部行動にあたる。 |
| `track-findings`（GitHub advisory / Jira / Linear）、`publish --to cloud` | **使えない** | 外部trackerやCloudへ書き込む（[track-findings SKILL](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/skills/track-findings/SKILL.md)） | 外部行動の人間ゲート（`External Action Authorization`）を迂回する。提出先もWordfence / Patchstackではない。 |
| Findings service / `dedupe` | **使えない** | importすると、findingのJSON全体をembeddings endpointへ送る。APIには認証がない（[README](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/README.md)） | 未公開findingを外部へ送ることになる。Campaignをまたいだ自動dedupも方針外である。 |
| `vulnerability-writeup` skill | **改造** | 開示用の文書形式を持つ。存在しないCVE、版、実行結果を書かないことを明記する（[SKILL](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/plugins/codex-security/skills/vulnerability-writeup/SKILL.md)） | Submission Draftの下書き支援に転用できる。Wordfence / Patchstackの提出様式に合わせる必要がある。 |
| License | **そのまま** | Apache-2.0（[LICENSE](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/LICENSE)、plugin manifestも同じ） | 改変と組み込みに支障はない。 |
| 利用条件（ChatGPT Pro / Codex） | **未確認** | docsは「Scans using OpenAI inference require Codex Security access」「full-repository scans may also require Trusted Access for Cyber」と書くが、planの名前は挙げていない（[CLI](https://learn.chatgpt.com/docs/security/cli)）。費用の推定は「not your bill or ChatGPT subscription allowance」（[README L324](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/README.md#L324)）。Cloudのscanは「not covered by your plan's included usage allowance」で、無料期間は2026-10-15まで、資格のあるaccountには$500のcreditが付く（[Cloud FAQ](https://learn.chatgpt.com/docs/security/faq)）。plugin 0.1.24 / 0.1.25は、ChatGPTでsign-inしたsessionでDaybreakへの資格を確認するが、scanを止めない（[changelog](https://learn.chatgpt.com/docs/security/plugin/changelog)） | Proのsubscriptionで「Codex Security access」が付くかは、実際のaccountで確認する必要がある。openai.comの一次記事は403で読めなかった。 |

#### Custom validation hookの事実（Observed）

- 指定方法は3つある。CLIの`--validation-prompt-file`（`scan`、`scans rerun`、`bulk-scan`、`patch`）、SDKの`validationPrompt` / `validationPromptFile`、project fileの`scan.validation_file`である（[cli.md L718-L772](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/docs/cli.md#L718-L772)）。standaloneの`validate`は持たない。SDKの`ValidationOptions`は`repositoryPath`と`finding`だけを受け取る（[api.ts L344-L351](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/api.ts#L344-L351)）。
- Discovery用のpromptは、標準のvalidationを外した版にSDKが差し替える。plugin本文のhashが一致しない場合は「Default validation was not started」として失敗させる（[custom-validation-prompt.ts](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/custom-validation-prompt.ts)）。
- Validationは新しいCodex threadで行う（`codex.startThread`、`workingDirectory`は`<scanDir>/artifacts`）。入力は固定された`candidates.json`で、候補の追加やidentityの変更は禁止される（[api.ts L2016-L2069](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/api.ts#L2016-L2069)、[custom-validation.ts L295-L330](https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/sdk/typescript/src/custom-validation.ts#L295-L330)）。
- 出力は`CustomValidationResult`である。`disposition`は`reportable` / `suppressed` / `not_applicable` / `deferred`のいずれか。setup失敗、不正な出力、一つでも`deferred`があれば、coverageは不完全になる。標準のvalidationへ黙って戻ることはない。
- 公式例は、agentがloopbackのHTTP serverを起動し、合成したidentityで応答codeを観測して停止する（[examples/custom-validation](https://github.com/openai/codex-security/tree/5ebe48db0585c5e582b0494236a01a739af13709/examples/custom-validation)）。READMEは「For a Docker-based project, the same prompt can run your existing compose or test script」と書く。

#### Codex記録契約の事実（Observed）

- **findingのidentity:** `findingId`は`csf_`、`occurrenceId`は`occ_`で始まる。`fingerprints.primary`は`codex-security/v1:sha256:…`の形式で、target ID、rule ID、anchor、instanceから導く。`validation.status`は自由文字列である。
- **coverage:** `completeness`は`complete` / `partial` / `unknown`の3値。`surfaces[].disposition`は`reported` / `no_issue_found` / `rejected` / `not_applicable` / `needs_follow_up`の5値。ほかに`deferred`、`resolvedDeferred`、`openQuestions`を持つ。
- **manifest:** `status`は`completed` / `failed` / `canceled` / `interrupted`の4値。`target.kind`は`git_revision` / `git_worktree` / `git_diff` / `directory_snapshot`の4値。

### 2. Anthropic Claude Security plugin

| 項目 | 分類 | Observed（根拠） | 本repositoryでの意味（Inference） |
| --- | --- | --- | --- |
| License | **使えない**（production / Sol） | proprietaryである。「license to install, run, and modify the Plugin for your internal use, solely with Claude Code or other Anthropic products and services」と定め、「use the Plugin or any part of it with … any non-Anthropic product」を禁じる（[LICENSE L1-L21](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/LICENSE)） | prompt、agent定義、workflowをSol / Codex側のPrompt Setへ移植できない。Claude Code上での開発時の比較に限る。 |
| 第三者のcodeを対象にする | **設定**（外部sandbox必須） | trust modelは「The code you scan is trusted」で、plugin自身は隔離を持たない。信頼できないrepositoryには[sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)の中でsession全体を動かすよう勧める（[README L13-L19](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/README.md#L13-L19)、[SECURITY.md](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/SECURITY.md)） | 対象側の`.claude/`、`CLAUDE.md`、`.git/config`もsessionに効く。そのため、Agent Sandboxの中で、対象のClaude Code設定を除いたcopyに対して実行する。 |
| 読み取り専用snapshot | **改造**（書き込み可能なcopyが必要） | 結果を「a timestamped `CLAUDE-SECURITY-<timestamp>/` directory in your repository」へ書く。VCSなしでも完全scanは動き、commitの代わりに`UNVERSIONED`を記録する（[docs](https://code.claude.com/docs/en/claude-security)） | Target Snapshotへ直接は書けない。使い捨てのcopyで実行し、結果を取り出す。 |
| PHPへの対応 | **そのまま** | inventoryは各componentの`language`を記録する。PHPはmanaged languageとして扱われ、`memory-and-unsafe` lensが外れる。残るlensは`injection-and-input`、`auth-and-access`、`crypto-and-secrets`（[workflows/scan.js](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/workflows/scan.js)） | WordPressに固有の観点は持たないが、PHPを対象にできる。 |
| Vendored codeの扱い | **設定** | scopeで指定しない限り、「ignore vendored and installed third-party code … report no finding there」（[README L49](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/README.md#L49)） | プラグインが同梱するComposerの`vendor/`は、scopeで明示しない限り報告対象にならない。 |
| 独立verifier | **使えない**（候補ゲートとして） | 3つのlens（REACHABILITY / IMPACT / DEFENSES）で1票ずつ投じる。3票中2票以上が`TRUE_POSITIVE`なら残し、severityは賛成票の中央値まで下げられるが上げられない。集計はmodelの外のcodeで行う（scan.js）。verifierは「Default to FALSE_POSITIVE」で、読み取り専用である。「If the finding could only be settled by running the code, that is a FALSE_POSITIVE」とする（[scan-verifier.md L26, L42](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/agents/scan-verifier.md#L26)）。残らなかった候補は「discarded, never shown」 | 実行しないと判定できない候補を偽陽性へ丸める。これはAGENTS.mdの「AIの失敗を棄却へ丸めない」「Human Candidate Review」と衝突する。「集計をcodeで行う」という考え方だけを参考にする。 |
| 出力（RESULTS.md / jsonl / sarif） | **そのまま**（開発時の比較記録として） | jsonlは`claudeSecurityPluginFindingId`を持ち、scanをまたいで安定するよう設計されている。hard-coded credentialの行は引用しない。SARIFは2.1.0で、CWEを付ける（[README L56-L62](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/README.md#L56-L62)） | 比較実験の外部記録としては使える。本repositoryの記録契約にはしない。 |
| Revision stamp | **改造**（考え方だけ） | `CLAUDE-SECURITY-REVISION-<sha12>.json`。未commitの変更があると名前に`-dirty`が付き、VCSがなければ`UNVERSIONED`になる。stamp内の`Revision`型は`versioned`、`commit`、`parent`、`branch`、`dirty`、`sparse`、`not_checked_out_dirs`、`base`、`merge_base`を持つ（[lib/revision.py](https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/scripts/lib/revision.py)） | 本repositoryはTarget Snapshotのdigestで結び付ける。「git状態を判定できないときは`null`にする」という扱いは参考になる。 |
| Patch生成 | **使えない** | 修正patchを提案する機能 | 製品の範囲外である。 |
| 利用条件（Claude Code Max） | **設定** | 「A paid plan, Anthropic API access, or a third-party provider」が必要で、Proではdynamic workflowsを有効にする必要がある。「each scan counts toward your usage」（[docs](https://code.claude.com/docs/en/claude-security)）。Pro / Maxの利用上限は「ordinary, individual usage of Claude Code and the Agent SDK」を前提とする（[Legal](https://code.claude.com/docs/en/legal-and-compliance)）。telemetryは`DISABLE_TELEMETRY=1`で止められる | Maxで実行できる。ただし大量の自動scanは「ordinary, individual usage」の前提から外れうる。開発時の少数比較に留める。 |

### 3. Anthropic defending-code-reference-harness（保守終了）

| 項目 | 分類 | Observed（根拠） | 本repositoryでの意味（Inference） |
| --- | --- | --- | --- |
| License | **そのまま** | Apache-2.0（[LICENSE](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/LICENSE)） | 本文を改変して転用できる。 |
| 自律pipeline（find → grade → report → patch） | **改造**（大規模） | C/C++とASANを前提とする。portでは、find / grade / report / patchのprompt、`asan.py`、`targets/<target>/Dockerfile`を差し替える。一方、orchestrationは「usually survives a port」（[customizing.md](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/customizing.md)）。find agentは対象を容器の中で実行する | WordPress用のDockerfile（WP + MySQL）とcanary判定器を書けば形は合う。しかし、Research中に対象を実行する構成は「探索は実行時攻撃を行わない」と衝突する。Candidate Verification側の参考に限る。 |
| Target定義の`known_bugs` | **設定**（空に保つ） | `config.yaml`の`known_bugs`は、find agentが参照する共有の重複表の初期値になる（[find_prompt.py L268-L276](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/find_prompt.py#L268-L276)） | 値を入れると既知脆弱性の位置を探索役へ渡すことになるため、空にする。 |
| `/threat-model bootstrap` | **改造** | History minerがgit historyをCVEなどのkeywordで採掘する。git remoteがGitHubで`gh`があれば、Advisory fetcherが`gh api …/security-advisories`を呼ぶ。`--vulns`がなくても両者は動き、無効化するflagはない（[bootstrap.md L26-L39, L112-L113](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/.claude/skills/threat-model/bootstrap.md#L26-L39)） | oracleが漏れる経路になる。`.git`を含まないsnapshotにし、networkと`gh`を遮断するか、本文から2つのagentを削る。`interview`模式は人間の回答を前提とする。 |
| `/vuln-scan` | **設定**（Claude Code上の比較方式） | 読み取り専用で、実行しない。言語は問わない。`--extra`で組織固有の観点を追加でき、`VULN-FINDINGS.json` / `.md`を出力する（[SKILL.md L1-L60](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/.claude/skills/vuln-scan/SKILL.md)） | WordPress向けの`--extra`を書けば、Claude Code上で比較できる。SARIFは出力しない。 |
| `--novelty` | **使えない**（Research内） | 既定はoff。upstreamをcloneして修正状況を確かめる（[pipeline.md L85](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#L85)） | 実行時確認の後にHuman OSで行う、最新版への適用可能性の確認としてなら検討できる。 |
| 認証（Claude Code Max） | **設定** | `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token`で取得）を受け付ける（[README L171](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md#L171)）。OAuthは「ordinary use of Claude Code」向けである（[Legal](https://code.claude.com/docs/en/legal-and-compliance)） | 改変していないClaude Code binaryを自分のsubscriptionで動かすことは許されている。大量の自律実行はAPI keyのほうが条件に合う。 |

### 4. Google Mantis（skill本文だけ）

| Skill | 分類 | Observed（根拠） | PHP / Webへの転用（Inference） |
| --- | --- | --- | --- |
| License | **そのまま** | Apache-2.0 | 本文を改変して転用できる。 |
| `mantis-history` | **使えない** | VCS historyから過去の脆弱性を採掘し、`historical_learnings.jsonl`を作る。`mantis-architecture`がこれを任意入力として読む（[architecture SKILL L36](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-architecture/SKILL.md#L36)） | 既知脆弱性をoracleとして使うことになる。実行しなければ取り込まれない。 |
| `mantis-threat-model` | **改造** | KBの`architecture.md`と`entities/*.md`だけから組み立てる「Stage B」である。前passのmodelは鮮度確認にだけ使う（[SKILL L34-L45](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-threat-model/SKILL.md#L34-L45)） | 入力をKB filesから受け取る形を、Programme BoundaryとTarget Snapshotへ置き換える必要がある。 |
| `mantis-researcher` | **改造** | `workspace/plan.json`の戦略に従う。`--snapshot_root` / `--snapshot_id`を`discovery_commit`へ記録する（[SKILL L14-L60](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-researcher/SKILL.md#L14-L60)） | `plan.json`をHarnessの状態にはしない。snapshotを記録する規則は既存方針と一致する。 |
| `mantis-critic` | **改造** | 「production viability」、つまりrelease build（assertion無効）でも発火するかを判定する | PHPでは「`WP_DEBUG`が有効なときだけ」「debug用endpoint」「既定で無効な設定」の判定へ書き換える。 |
| `mantis-reproduce` | **そのまま**（判定規則） / **改造**（本文） | Tier 1〜3があり、Tier 3（Docker、QEMU、VMなどの隔離serviceの全体）だけが`reproduced`を出せる。setup失敗は「`setup_failed`… NEVER `failed_to_bypass`」とする。logicやauthorizationのbugでは、「unauthorized request returns `200 OK`」のような実証を成功とする。本文の多くはASanなどsanitizerの判定である（[SKILL L310-L345, L520-L545](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-reproduce/SKILL.md#L310-L345)） | Tier 3限定とsetup失敗の扱いは、`incomplete`の規則としてそのまま採れる。ただし「200 OK」は判定として弱い。本repositoryでは、種別ごとのnonce canaryで置き換える。 |
| `mantis-dedupe` | **改造** | 決定的に一致しないものは別件として保つ（fail-closed）。前passのarchiveと照合する。`historical_learnings.jsonl`とは「Do NOT … deduplicate against」とする（[SKILL L125-L140](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-dedupe/SKILL.md#L125-L140)） | Campaign内の重複統合には転用できる。pass / Campaignをまたいだarchiveとの照合は行わない。 |
| `mantis-calibrate` | **改造** | 1〜10のrisk matrixで、同じ入力なら同じ出力になる（決定的）。`THREAT_MODEL.md`によるboundaryの上書きを読む。規則は[`references/calibration_rules.md`](https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/mantis-calibrate/references/calibration_rules.md)にある | severityの付け方は、Wordfence / PatchstackのCVSS運用に合わせて書き直す。Programmeの対象範囲の判定には使わない。 |

### 5. Cloudflare security-audit-skill

| 項目 | 分類 | Observed（根拠） | 本repositoryでの意味（Inference） |
| --- | --- | --- | --- |
| License | **そのまま** | MIT（[LICENSE](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/LICENSE)） | 既存のCloudflare-derived Prompt Setに法的な制約はない。 |
| Web向けのcompanion（`WEB-PROTOCOL-AND-AUTH.md`、`ATTACK-CLASSES.md`、`DATA-ISOLATION-AND-LIFECYCLE.md`） | **そのまま**（既採用） | 言語を問わない観点の一覧 | 既存noteどおり採用済み。PHP / WordPressでは`MEMORY-SAFETY-AND-BINARY.md`の価値が低い。 |
| `ATTACK-CLASSES.md`のgit historyへの問い | **設定** | 「Is there anything interesting in the git history? Reverted security fixes…」（[L103](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/ATTACK-CLASSES.md#L103)） | `.git`を含まないTarget Snapshotなら答えようがない。WordPress.orgのSVN配布物には、もともとgit historyがない。 |
| 実行の境界 | **そのまま**（規則の文面） | 対象codeの実行は、親が承認したOSレベルのsandboxの中だけで行う。条件は、外部network無効、空のallowlist環境、対象とtoolは読み取り専用、scratchだけに書き込み、資源上限、である。どれかが欠けたら「do not execute: return needs_validation」とする。「Isolated loopback is allowed only for a local fixture」（[HUNTING.md L71-L80](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/HUNTING.md#L71-L80)） | Candidate Verificationのno-silent-fallbackと一致する。WP + MySQLの複数容器は「local fixture」の範囲を超えるため、Lab側で同等の制約を課す。 |

## 横断確認

| 確認事項 | Codex Security | Claude Security plugin | Reference harness | Mantis | Cloudflare |
| --- | --- | --- | --- | --- | --- |
| 第三者の読み取り専用snapshotを対象にできるか | できる（`directory_snapshot`。出力は対象の外）。ただしhost全体を読める | 書き込み可能なcopyが必要（結果をrepository内へ書く） | できる（skillは読み取り専用） | できる（`--snapshot_root`） | できる（scratchだけに書き込む） |
| 自前のWP + MySQLをvalidationへ接続できるか | custom validation promptから自前のscriptを呼べる。standard / diffに限る | できない（verifierは実行禁止） | target Dockerfileを差し替える（大規模な改造） | 「containerization tools provided by your environment」任せ | 親が承認したsandboxが条件で、接続の仕組みはない |
| 既知脆弱性を自動で取り込むか / 無効化できるか | 与えなければ起動しない。FP feedbackは新しいstate dirで無効化できる | git historyの読み取りは許される（researcherの`git log` / `blame`）。advisoryの採掘はない | bootstrapが自動で採掘し、flagはない。本文の削除か`.git`なしのsnapshotで止める | `mantis-history`を実行しなければ取り込まない | git historyへの問いがある。`.git`なしで無効になる |
| 出力形式をそのまま記録契約にできるか | できない（添付物かexportに留める） | できない | できない | できない（`schema.json`は参考） | できない（既存noteどおり） |

## 自作が避けられない部分の一覧

各ツールの機能一覧に該当機能がないことを根拠とする。「最も近い既製部品」は、自作するときの参照先を示す。

| 自作部分 | 各ツールにない根拠（Observed） | 最も近い既製部品（Inference） |
| --- | --- | --- |
| WordPress Lab（gVisor内のWP + MySQL。検証ごとに新しく作る。正確な版のplugin。roleとuser） | Codexのcustom validationは、setup、対象、cleanupを利用者のpromptに委ねる（公式例はloopbackのNode server）。Reference harnessはC/C++ + ASANのDockerfileを前提とする。Mantis reproduceは「Sandbox/container runtime environment must be available」を前提条件とするだけである。Claude Security pluginは実行しない。 | Codex custom validationの入出力契約（固定された候補集合、1候補に1結果、`deferred`はcoverage不完全、fallbackなし） |
| 種別別のcanary判定器 | Codexは`disposition`をmodelが決める。Reference harnessはASAN signatureで判定する。Mantisはsanitizerの出力と「200 OK」相当の実証で判定する。Claude Security pluginは3票の多数決（静的）である。どれもnonce canaryによる決定的な判定器を持たない。 | Mantis Tier 3の規則と、Cloudflareの「minimum observed effect」。XBOWのcanaryは既存noteを参照。 |
| Programme Boundaryとscope評価 | Codexの`scope`はfile pathとdiffである。Claude Securityの`Coverage`は読んだ範囲を示す。Mantisのscopeはplan.jsonである。どれもbounty programmeの対象範囲、対象外の種別、必要な権限の判定を持たない。 | Codexのthreat model `assumptions`と、`SECURITY.md`の解決順序（形式の参考に限る） |
| 既知脆弱性を渡さない評価 | Codexの`evals/`はtriageとsecret discoveryの評価で、既知の正解ラベルを使う。Reference harnessのgradeはcrashの真偽を判定する。Mantisの評価は公開されていない。どれもoracle-freeな将来志向のrecallを測らない。 | なし |
| 提出フロー（Wordfence / Patchstack、人間の承認） | Codexの`track-findings`はLinear、Jira、GitHub issue、GitHub advisoryだけに対応し、`publish`はCodex Cloudへ送る。Claude Securityはpatch止まりである。どれも提出先が異なり、`External Action Authorization`に相当するgateを持たない。 | Codexの`vulnerability-writeup`（下書きの形式だけ） |
| Human Candidate Reviewと、候補に結び付いたVerification Request | Codex custom validationはdiscoveryの直後に同じscanの中で自動実行される。Claude Securityは残らなかった候補を表示しない。人間が採否を決めるgateは、どのツールにもない。 | 既存noteの推奨1（自動検証を人間の採否の前へ移す案）を採るなら、Codexの順序は自然に合う。 |

## 推奨（Observed / Inferenceを分ける）

### Observed（判断の前提）

- Codex SecurityはApache-2.0で、PHPを対象から外していない。非Gitのsnapshot、custom validation、threat modelの外部入力、新しいstate directoryによる履歴の遮断を、公式の設定で扱える。
- Claude Security pluginはproprietaryで、Anthropic製品の外では使えない。verifierは実行禁止で、実行しないと判定できない候補を偽陽性とする。
- Reference harnessの`/threat-model bootstrap`は、既知脆弱性を自動で採掘する。無効化するflagはない。
- Mantis、Cloudflareとも、決定的なcanary判定器とProgramme scopeを持たない。

### Inference（採用案。変更gateとIssueを経るまで決定ではない）

1. **Codex Securityは「upstream比較方式」として隔離して試す。Research本体にはしない。**
   - 固定段階であるため、Rootの裁量（AGENTS.md）と衝突する。既存の`cloudflare-upstream`と同じ扱いにする。
   - 条件は次のとおり。
     - Agent Sandboxの中で実行する。
     - Campaignごとに新しい`CODEX_SECURITY_STATE_DIR`を使う。
     - knowledge baseとinstructionに既知脆弱性を含めない。
     - `max_concurrent_threads_per_session=4`にする。
     - `approval_policy="never"`にする。
     - `analytics.enabled=false`にする。
2. **先にspikeで3点を確かめる。**
   - (a) gVisorの中でCodex Securityが要求するBubblewrapが動くか。動かない場合、scanには外部sandboxへ切り替える公式の口がない。
   - (b) ChatGPT Proのsign-inで「Codex Security access」と、必要ならTrusted Access for Cyberが得られるか。そのときの課金がsubscriptionの範囲に入るか。
   - (c) custom validationのthreadから、隔離したLabへ到達できるnetwork権限を、agentへ容器socketを渡さずに与えられるか。
3. **記録は自前の版付き契約を正本に保つ。** Codexの3つのJSONとSARIFは、digest付きの添付物として保存する。取り込む価値のある考え方は3つある。
   - coverageの`completeness`を3値にすること（`unknown`を持つ）
   - `directory_snapshot`の`snapshotDigest`の作り方
   - findingの指紋を「target、rule、anchor、instance」から導くこと
4. **自前Labへの接続は、Codex custom validationの入出力契約を手本にして自作する。**
   - 採る要素: 固定された候補集合、1候補に1結果、`deferred`はincompleteにする、標準のvalidationへ戻らない。
   - 判定: 実行はHuman OSのLabが行い、判定はcanary判定器が行う。LLMには判定させない。
   - 順序: 既存noteの推奨1（自動検証を人間の採否の前へ移す）を採る場合だけ、Codexの「discoveryの直後に自動で検証する」順序と一致する。
5. **Claude Security pluginとreference harnessは、開発時にClaude Code Max上で比較するためだけに使う。** Claude Security pluginはlicense上、Sol側へ移植できない。reference harnessの`/vuln-scan`をWordPress向けの`--extra`付きで使う場合は、`.git`を含まないsnapshotで実行する。`/threat-model bootstrap`は使わない。
6. **Mantisから採るのは判定規則の文面だけである。** 対象は`mantis-reproduce`のTier 3限定とsetup失敗の扱い、`mantis-dedupe`のfail-closedである。`mantis-history`と`plan.json`の状態管理は採らない。
