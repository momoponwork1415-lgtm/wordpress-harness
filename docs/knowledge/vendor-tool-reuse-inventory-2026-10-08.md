状態: 調査完了（取得日 2026-10-08）。Issue #239向け。コード変更なし。対象ツールは実行・インストールしていない（固定commitのソースと公式docsを読んだだけ）。learn.chatgpt.comの各ページには公開日・更新日がなく、取得日で示す。Claude Security pluginのdocsにも日付がない。Codex Security Cloudの検証環境の内部実装、OpenAIのTerms of Use / Usage Policies本文（openai.com、403の既往あり）は読んでいない。

# 大手公開ツールの再利用可能範囲

既存note（[参照設計の比較](pipeline-reference-designs-2026-10-08.md)、[参考ハーネスの比較](reference-harness-observability.md)）にあるパイプラインの形、段階、changelogは繰り返さない。このnoteは**具体的な部品を、このrepositoryでそのまま・設定で・改造して使えるか**だけを扱う。

分類の意味:

- **そのまま:** 本repositoryの不変条件（[AGENTS.md](../../AGENTS.md)）を破らず、コードや本文を変えずに使える。
- **設定:** 公開された設定・引数・環境変数だけで不変条件に合わせられる。
- **改造:** 本文やコードの書き換え、または外側での包み込み（gVisor container等）が要る。ライセンス上も改変が許される。
- **使えない:** 不変条件、ライセンス、または対象（PHP / WordPress）との不一致で使えない。理由を付ける。

## 結論

1. **どの大手ツールも、Harness全体の代わりにはならない。** 5社分を読んだ範囲で、WordPress + MySQLの使い捨てLab、種別ごとのcanary判定器、bug bountyプログラムの対象範囲評価、既知脆弱性を渡さない評価、提出フローのいずれかを同梱するツールはない（Observed）。5部品はすべて自作が残る。ただし、5部品のうちWordPress Lab（`gvisor-wordpress-dynamic-reproduction.ts`）、Programme Boundary / 全programmeのscope評価（Human OS v3）、外部行動の承認記録は、本repositoryに既にある。新しく作る必要があるのは**種別別canary判定器**だけである（現行のrecipeは`HARNESS_RESULT=`の`effectObserved`を自己申告する。`src/`に`canary`の実装は見つからない。Observed）。
2. **OpenAI Codex Security（Apache-2.0、`5ebe48d`、npm 0.2.0）は最も再利用しやすい。ただし探索側に限られる。**
   - **設定で使える部分:** 探索（`scan --path`、`--knowledge-base`、`--mode deep`）、model / provider の選択（OpenRouter、Fireworks、Bedrock、Responses APIを話す任意のprovider）、`findings.json` / `coverage.json` / `scan-manifest.json`の出力、`approval_policy="never"`。
   - **custom validation:** `scan --validation-prompt-file`で、検証段を任意の手順に置き換えられる。公式例はローカルのスクリプトを実行し、HTTPで検証する。WordPress Labを呼ぶ手順も書ける。
   - **改造が必要な理由:**
     - scanのpermission profileは`":root": "read"`（ローカルfilesystem全体を読める）である。既定の`approval_policy`は`on-request`で、`approvals_reviewer: "auto_review"`が権限の追加を自動で承認し得る。gVisor containerで包み、`approval_policy="never"`を強制しないと、本repositoryの隔離要件を満たさない。
     - 標準scanの検証は**ソースだけ**で行う（「do not require ... runtime reproduction」）。実行時の検証はcustom validationか`validate`コマンドに限られ、deep scanとは併用できない。
     - custom validationは、人間の採否より前に、scanと同じsessionの中で動く。Human Candidate Reviewの後に新しい環境で一度だけ検証する本repositoryの順序と合わない。
     - false-positive feedbackは、同じ`target_id`の過去scanで人間が閉じた最新50件を、次のscanの入力へ自動で注入する。独立試行ごとに`CODEX_SECURITY_STATE_DIR`を分けないと、試行の独立性が崩れる。
     - deep scanの停止規則（`stop_after_no_new`、`max_discovery_runs`、`max_time_hours ≤ 96`）は、Rootの`continue` / `stop`判断と別物である。
   - **PHP:** 公式FAQは「language-agnostic」と書く。PHP固有のlogicはない（評価fixtureにPHPのcaseが1件あるだけ）。
   - **利用条件:** 「Scan only code you own or have permission to assess」。Trusted Access for Cyberは「only for systems you own or are explicitly authorized to assess」。bug bountyプログラムの許可がこれに当たるかは、公式文書に明示がない。
3. **Anthropic Claude Security plugin（`claude-security` 0.12.0）は、ライセンス上、Grok / Codexの腕へ転用できない。** LICENSEは「All rights reserved」の独自ライセンスである。「solely with Claude Code or other Anthropic products」と定め、「use ... with ... any non-Anthropic product」と再配布を禁じる。使えるのは、Claude Codeの腕として**そのまま**呼ぶこと（外側をgVisorで包む。pluginは「adds no isolation of its own」と明記）だけである。
   - **verifierの性質:** read-onlyの3 lens（REACHABILITY / IMPACT / DEFENSES）が投票し、「Default to FALSE_POSITIVE」で、実行が必要な主張はFPにする。検証できなかった候補は破棄する。本repositoryの「`incomplete`を否定へ丸めない」と逆向きなので、Candidate Verificationの代わりにはならない。
   - **出力形式:** JSONL、SARIF 2.1.0、revision stampの形式は、設計の参考になる。
4. **Anthropic `defending-code-reference-harness`（Apache-2.0、`d3bea6b`）は保守終了済み。** READMEは2026-05-30の更新から「not maintained」と記す。理由は書かれておらず、managed product（Claude Security）へ誘導するだけである。
   - **再利用できるもの:** gVisor（`runsc`）+ egress allowlist proxyの構成（`scripts/setup_sandbox.sh`、`egress_proxy.py`）と、run statusの分類。どちらも**改造**で使える。
   - **再利用できないもの:** find / grade promptと`asan.py`はC/C++とASanに固定されている。WordPressでは判定器の置き換えが必須である。
5. **Google Mantis（Apache-2.0、`2b3bbdc`）のskill本文は、ハーネスに依存しないMarkdownである。** ADK / Geminiとの結合は`reference/`側にある（`google-adk==2.9.1`、`litellm`経由）。
   - **改造で転用できるもの（19 skill中12）:** researcher、review、dedupe、reproduce（Tier 3を「使い捨てWordPress Lab経由」に置き換える）、chain、calibrate、report、threat-model、architecture、summarize、structural-index、critic（`WP_DEBUG`等への読み替え）。
   - **使えないもの:** `mantis-history`と`mantis-advise`は過去の脆弱性を探索へ入れる（oracleに当たる）。`mantis-reflect`と`mantis-meta-agent`は試行をまたぐlearningsを持つ（独立試行と衝突する）。`mantis-plan`は`plan.json`をharness状態にする。
6. **Cloudflare `security-audit-skill`（MIT、`c1c8a8c`、2026-10-08時点でも最新）は既に採用済みである。** 探索方式`cloudflare` / `cloudflare-upstream`のpromptとして使っている。
   - **言語非依存の部分:** 本体の6段階と、companionのうちWEB-PROTOCOL-AND-AUTH、ATTACK-CLASSES、DATA-ISOLATION-AND-LIFECYCLE、CLIENT-SIDE、SUPPLY-CHAIN-AND-RELEASE、RESOURCE-EXHAUSTION。PHP / WordPress固有の記述はない。
   - **衝突する部分:** 前回runの`findings.json`と`coverage-ledger.json`を引き継ぐ規則は、独立試行と衝突する。
7. **Issue #238への含意（Inference）。** 「大手スキャナを薄く包む」案が成り立つのは、**探索側をCodex Security CLI / SDKへ置き換え、Human OS（Lab、scope、提出）を残す**形だけである。
   - **必要な包み込み:** gVisor container、`approval_policy="never"`、試行ごとのstate dir、custom validationを使わない（または人間の採否の後に別プロセスで呼ぶ）設定。
   - **調べていないこと:** Rootの`continue`による自律継続と、ルート込み最大4体の上限をCodex Securityの中で再現できるか。既定はparent + 8 thread。`features.multi_agent_v2.max_concurrent_threads_per_session`で変えられるが、deep scanのworker数とは別の上限である。
   - **Claude Security:** Anthropic以外の腕を持てないため、土台には使えない。

## 証拠の境界

- **Observed:** 下表の固定commitにあるソースとdocs、または取得日を付けた公式docsで確認した事実。
- **Inference:** このrepositoryへの判断。採用決定ではない。

| 資料 | 固定点 | 日付 | 読んだもの |
| --- | --- | --- | --- |
| [openai/codex-security](https://github.com/openai/codex-security/tree/5ebe48db0585c5e582b0494236a01a739af13709) | `5ebe48db0585c5e582b0494236a01a739af13709`、`@openai/codex-security` 0.2.0 | commit 2026-10-08、release `npm-v0.2.0` 2026-10-06 | README、LICENSE、`docs/project-configuration.md`、`sdk/typescript/README.md`、`sdk/typescript/docs/cli.md`、`sdk/typescript/src/api.ts`・`config.ts`・`index.ts`、`plugins/codex-security/schemas/*.schema.json`、`references/core-scan.md`・`threat-model.md`、`skills/validation`・`vulnerability-writeup`、`scripts/workbench_feedback.py`・`workbench_scan_start.py`、`examples/custom-validation/` |
| learn.chatgpt.com（Codex Security docs） | — | 取得日 2026-10-08（ページに日付なし） | [plugin](https://learn.chatgpt.com/docs/security/plugin)、[scans](https://learn.chatgpt.com/docs/security/plugin/scans)、[Cloud FAQ](https://learn.chatgpt.com/docs/security/faq)、[CLI FAQ](https://learn.chatgpt.com/docs/security/cli/faq)、[cyber-safety](https://learn.chatgpt.com/docs/cyber-safety)、[cloud environment](https://learn.chatgpt.com/docs/environments/cloud-environment) |
| [openai/codex-universal](https://github.com/openai/codex-universal/tree/47f4f0eb5337083e2f610db0d15558932cb4901d) | `47f4f0e` | commit 2026-05-02 | `Dockerfile`のPHP / MySQL行だけ |
| [Claude Security plugin docs](https://code.claude.com/docs/en/claude-security) | — | 取得日 2026-10-08（日付なし） | 全文 |
| [anthropics/claude-plugins-official `plugins/claude-security`](https://github.com/anthropics/claude-plugins-official/tree/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security) | repo `b78ac49`、plugin最終変更 `ca08d5e`（2026-09-25）、`plugin.json` version 0.12.0 | repo commit 2026-10-07 | LICENSE、NOTICE、README、`agents/scan-verifier.md`、`workflows/scan.js`（先頭部）、`scripts/render_report.py`、`scripts/lib/finding.py`・`revision.py` |
| [anthropics/defending-code-reference-harness](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) | `d3bea6b`（既存noteと同じ） | 最終commit 2026-08-06。「not maintained」の記述は`81e5081`（2026-05-30）から | README、LICENSE、`docs/customizing.md`、`docs/agent-sandbox.md`（該当行）、`harness/artifacts.py`・`agent.py`、`harness/prompts/grade_prompt.py`（見出し）、`scripts/` |
| [google/mantis](https://github.com/google/mantis/tree/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80) | `2b3bbdc`（既存noteと同じ。2026-10-08もHEAD） | commit 2026-10-06 | README、LICENSE、19個の`mantis-*/SKILL.md`のfrontmatterと該当節、`reference/requirements.txt` |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8) | `c1c8a8c`（既存noteと同じ。2026-10-08もHEAD） | commit 2026-09-14 | README、LICENSE、file一覧、`SKILL.md`・`HUNTING.md`の該当節 |

- **読めなかったもの・読まなかったもの:**
  - OpenAIのTerms of UseとUsage Policiesの本文。cyber-safetyページが「remain subject to the Usage Policies and Terms of Use」と参照するだけで、bug bountyでの第三者コードの扱いは確認していない。
  - Codex Security Cloudの検証containerの構成。FAQは「ephemeral Codex container」とだけ書く。
  - learn.chatgpt.comのCodex Security docsには、research preview / betaの表示がない。plugin quickstartは、CLIを「if you have beta access」の条件付きで案内している。
- **二次資料:** 使っていない。
- **やっていないこと:** どのツールもインストール・実行していない（`npm install`、`pip install`、plugin install、scan、検証scriptの実行のいずれも）。clone先（scratchpad）では読み取りだけを行った。WordPress対象への性能は一切評価していない。

## 棚卸し表

### OpenAI Codex Security（`openai/codex-security` `5ebe48d`、npm 0.2.0）

以下の根拠リンクの基点は`https://github.com/openai/codex-security/blob/5ebe48db0585c5e582b0494236a01a739af13709/`。

| 部品 | 分類 | 根拠（一次資料, 日付） | WordPress / PHPでの注意 | ライセンス・利用条件 |
| --- | --- | --- | --- | --- |
| threat model（形式・編集） | 設定 | `references/threat-model.md`。canonical objectは`summary`、`assets`、`trustBoundaries`、`attackerCapabilities`、`securityObjectives`、`assumptions`（+`origin`、`scope`）。与えられたmodelは「unchanged」で保持し、Markdownは`{format: "markdown", content, origin: "provided"}`として扱う。ローカルCLIでは`SECURITY.md`、`--knowledge-base`、context経由で与え、`export --artifact threat-model`で取り出す。Cloudだけが画面上で編集できる（[threat-model](https://learn.chatgpt.com/docs/security/threat-model)、取得日） | Programme Research Boundaryの攻撃者位置と優先影響を`attackerCapabilities` / `securityObjectives`へ写せる。既知脆弱性を書き込まない運用の規律が要る | Apache-2.0 |
| scan phases（standard / deep / diff） | 設定 | `docs/project-configuration.md`（`scan.mode`、`scan.scope`、`scan.deep.*`）。core scanは「inspect only its authorized current state rather than other revisions or Git history」で、application codeを実行しない（`references/core-scan.md` 9・70行） | git historyを読まないので、oracleを避ける方向に合う。deep scanの固定停止規則（既定: 4 worker、新規なし4連続、40 run、96時間）は、Rootの`continue`と置き換わる | 同上 |
| 標準scan内の検証 | 使えない（Candidate Verificationの代替としては） | `references/core-scan.md` 15行「do not require proof of a real deployment or runtime reproduction」。source-backedな検証である | `runtime-confirmed`を生成できない。Research内の自己反証としてなら使える | 同上 |
| custom validation（`--validation-prompt-file` / `validationPrompt`） | 改造 | `sdk/typescript/docs/cli.md` 718行〜。`CustomValidationResult`の`status`、`reason`、`validations[].candidateId`、`validation.{disposition, method, confidence, confidence_rationale, rubric, evidence, counterevidence_or_proof_gap, remaining_uncertainty, artifact_paths}`、`severity`、`impact`。dispositionは`reportable` / `suppressed` / `not_applicable` / `deferred`。deep scanでは使えない。setupの失敗は「incomplete coverage」で、通常検証へfallbackしない。`examples/custom-validation/`はloopback HTTPのscriptを実行する | WordPress Labを起動するscriptを呼ばせることはできる。ただし、(a) 人間の採否より前に動く、(b) LLMがscriptを起動し、結果を解釈する、(c) scanのsandbox内からLabへ届く経路が要る。`suppressed`は`contradicted`と`incomplete`を区別しないので、写像の規則が要る | 同上 |
| standalone `validate` / validation skill | 改造 | `skills/validation/SKILL.md`。PoC、統合test、「realistic interface reproduction」を優先する。setup errorは「not ... immediate counterevidence」 | 方針は本repositoryと一致する。ただし、実行はscan profile（ローカルFS全体read、workspace write）の中で行い、対象コードをその場で動かす。ホスト上で動かさないためにはgVisorで包むことが必須 | 同上 |
| 検証のsandbox / 隔離 | 改造 | README「Local security model」: 「runs with your operating-system permissions」。`api.ts` 4569–4600行: `":root": "read"`、`":workspace_roots": "write"`、`approvals_reviewer: "auto_review"`、既定の`approval_policy`は`on-request`（`config.ts` 178行）。Linuxではbubblewrapが要る（cli.md 1378行）。patchだけが`--external-sandbox`を持つ | gVisor相当以上を要求する本repositoryの要件は、外側のcontainerで満たす必要がある。`approval_policy="never"`は設定で強制できる | 同上 |
| 独自の実行環境（WordPress + MySQL）の接続 | 改造 | Cloud: 「ephemeral Codex container」で、詳細はCodex cloud environmentsを参照（[FAQ](https://learn.chatgpt.com/docs/security/faq)、取得日）。cloud environmentは`codex-universal`とsetup scriptで構成し、agentのinternetは既定off（[cloud environment](https://learn.chatgpt.com/docs/environments/cloud-environment)、取得日）。`codex-universal` `47f4f0e`はPHP 8.2〜8.5を含むが、MySQL serverは含まない（`default-libmysqlclient-dev`だけ）。ローカルでは、custom validationのscriptが唯一の差し込み口 | WordPress / MySQLの起動、seed、nonce付きcanaryの準備は、すべて自前のscriptになる。Cloudは接続済みGitHub repoしか扱わず、WordPress.orgのSVN配布物を扱えない | 同上 |
| `findings.json` schema | そのまま（交換形式として） | `plugins/codex-security/schemas/findings.schema.json`。`documentType: "codex-security.findings"`、`schemaVersion: "1.0"`、`scanId`、`findings[]`。必須: `findingId`、`occurrenceId`、`ruleId`、`identity{anchor, instance}`、`fingerprints{algorithm: "codex-security/v1", primary}`、`title`、`summary`、`severity{level, score, scoringSystem, vector, rationale, changeConditions}`、`confidence{level, rationale}`、`taxonomy{category, cwe}`、`locations`、`remediation`、`provenance{source}`。任意: `validation{status, disposition, result, method, evidence, counterEvidence, limitations, assertions, summary, evidenceRefs}`、`attackPath{assumptions, blindspots, controls, dataFlow, impact, likelihood, preconditions, reachability, steps, summary}`、`rootCause`、`writeup.reportPath`、`extensions{candidateId, ledgerRowId, reportId}` | ResearchReport v2の順序付きsource trace、防御評価、未解決事実は`attackPath`と`validation`へ写せる。Candidate Verificationの3値はこのschemaにない | 同上 |
| `coverage.json` schema | 設定（読み取り専用の比較viewとして） | `coverage.schema.json`。`mode`、`completeness`（`complete` / `partial` / `unknown`）、`inventoryStrategy`、`includePaths`、`excludePaths`、`surfaces[]{id, label, disposition, receiptRefs, riskArea, notes}`。dispositionは`reported` / `no_issue_found` / `rejected` / `not_applicable` / `needs_follow_up`。他に`explicitExclusions`、`deferred`、`resolvedDeferred`、`openQuestions` | 本repositoryはcoverageを完了証明にしない。`completeness`を探索の閉鎖へ読み替えない規律が要る | 同上 |
| `scan-manifest.json` schema | そのまま（Receiptの参考として） | `scan-manifest.schema.json`。`scan{id, producer{name, version}, status(completed / failed / canceled / interrupted), startedAt, completedAt, sealedAt, target{kind, targetId, displayName, remote, revision, baseRevision, headRevision, snapshotDigest}, scope{includePaths, excludePaths, summary, artifactsReviewed, runtimeStatus, validationMode, context, limitations}, threatModel, hardening, coverageRef, findingsRef, artifacts[]{path, sha256, mediaType}}` | `target.kind`に`directory_snapshot`があり、SVN由来の展開物も表せる | 同上 |
| false-positive feedback | 改造（独立試行では無効化が必須） | `findings false-positive OCCURRENCE_ID --reason`（cli.md 1024行）。`scripts/workbench_feedback.py`は、同じ`target_id`の他の完了scanで`close_reason = 'false_positive'`かつnoteがある最新50件を返す。`workbench_scan_start.py`はそれを`artifacts/01_context/false_positive_feedback.json`へ書く。validation skillは「matching finding」を、理由がまだ成り立つ時だけ抑制する | 人間の過去判断が次の試行へ流れる。独立試行では`CODEX_SECURITY_STATE_DIR`を試行ごとに新しくする | 同上 |
| SDKの入口 | 設定 | package `@openai/codex-security`（Node ^22.13 / 24 / 26、Python 3.10+）。`new CodexSecurity({codexOverrides, pythonPath, pluginPath})`、`run(repo, ScanOptions)`、`validate()`、`preflight()`、`generatePolicy()`、`close()`。`loadProjectConfig()` / `resolveProjectConfig()`、`exportArtifact()`、`ScanResult.hasFindingsAtOrAbove()`、callbackの`onProgress`、`onCost`、`onWorkerEvent`（`sdk/typescript/src/index.ts`、`api.ts`）。依存は`@openai/codex` / `@openai/codex-sdk` `0.162.0-alpha.18` | 本repositoryのCodex CLIは0.146.0に固定している。SDKを使うと、prereleaseのCodexが同梱される | 「Before version 1.0.0, minor releases may change the public API」 |
| model / provider | 設定 | `--model`、`--effort`はそのまま渡す（cli.md 490行〜）。既定は`gpt-5.6-sol` / `xhigh`。providerはOpenAI、Bedrock、OpenRouter、Fireworks（root README 169行）。任意のproviderは`model_providers.<id>`で指定する（`wire_api="responses"`）。`--cyber-access-program`もある | Grok / GLM / DeepSeekは、Responses API互換の経路があれば指定できる。品質と、tool / multi-agentの互換性は未確認 | OpenAIのmodelではTrusted Access for Cyberの条件に従う |
| 言語対応 | そのまま | 「Codex Security is language-agnostic」（[FAQ](https://learn.chatgpt.com/docs/security/faq)、取得日）。repo全体でPHP固有の処理はない。PHPは`evals/triage-finding`のcalibration caseに1件あるだけ | WordPressのhook / nonce / capabilityについての知識は、modelとknowledge baseに依存する | — |
| `vulnerability-writeup` skill | 改造 | `skills/vulnerability-writeup/SKILL.md`。exact source revision、攻撃者位置、影響を確定してから書く。「Never invent ... CVE, CVSS vector」 | Submission Draftの作成支援に転用できる。影響版の特定はgit tagを前提にしており、WordPress.orgのSVN tagへの読み替えが要る。提出・承認は代行させない | Apache-2.0 |
| publish（Cloud / Linear / findings service） | 使えない | cli.md 774行〜、817行〜 | 外部への送信は人間ゲートの外にある。Wordfence / Patchstackへの提出経路はない | — |
| 利用条件 | — | 「Scan only code you own or have permission to assess」（[plugin](https://learn.chatgpt.com/docs/security/plugin)、取得日）。TACは「only for systems you own or are explicitly authorized to assess」「All users remain subject to the Usage Policies and Terms of Use」（[cyber-safety](https://learn.chatgpt.com/docs/cyber-safety)、取得日） | bug bountyプログラムの許可が「explicitly authorized」に当たるかは未確認 | — |

### Anthropic Claude Security plugin（`claude-security` 0.12.0）

以下の根拠リンクの基点は`https://github.com/anthropics/claude-plugins-official/blob/b78ac49cdc6b3d7b61c4439470e311f4291265b1/plugins/claude-security/`。

| 部品 | 分類 | 根拠（一次資料, 日付） | WordPress / PHPでの注意 | ライセンス・利用条件 |
| --- | --- | --- | --- | --- |
| 導入方法と実行条件 | 設定（Claude Codeの腕に限る） | `/plugin install claude-security@claude-plugins-official`。paid plan、API、または第三者provider（Bedrock等）が必要。dynamic workflows（Workflow tool）とPython 3.9+も要る。「The plugin makes no model calls of its own」（[docs](https://code.claude.com/docs/en/claude-security)、取得日） | Workflow toolがないsessionでは停止する（`agents/claude-security.md`） | 独自ライセンス（下記） |
| 隔離 | 改造（外側で包む） | README「Where it runs」: 「adds no isolation of its own」。信頼できないrepoにはsandbox-runtimeを勧める | `.claude/`、`CLAUDE.md`、hooksがそのまま効く。対象のplugin repoを開くと危険なので、gVisorで包むことが必須 | — |
| 独立verifier | 使えない（Candidate Verificationとして）/ そのまま（Claude腕の内部としてなら） | `agents/scan-verifier.md`: 3 lens（REACHABILITY / IMPACT / DEFENSES）が一票ずつ投じ、集計はmodelの外で行う。「Default to FALSE_POSITIVE」。「only read-only commands ... No building, no tests, no execution, no network」。「If the finding could only be settled by running the code, that is a FALSE_POSITIVE」 | 実行時の検証をしない。未検証の候補は破棄し、表示しない。`incomplete`を保持する本repositoryと逆向き | — |
| revision stamp | そのまま（設計参考として） | `CLAUDE-SECURITY-REVISION-<sha12>[-dirty].json`。`render_report.py` 849行: `generated_at`、`duration_s`、`scan_id`、`mode`、`scan_prefix`、`scope`、`revision{versioned, commit, parent, branch, dirty, sparse, not_checked_out_dirs, base, merge_base}`、`revision_source`、`model`、`effort`、`run_shape`、`findings{total, critical, high, medium, low}`、`verification{status(verified / unverified), candidates, candidates_deduped, panel_votes, panel_reviewed_findings, panel_quorum_findings, unreviewed_candidate_sites, incomplete_panel_candidates, attested_findings, reason, reason_kind, ...}` | Native Run Receiptの記録項目と比べる材料になる。コードは移植できない（ライセンス） | — |
| 出力形式 | そのまま（交換形式として） | `CLAUDE-SECURITY-RESULTS.md` / `.jsonl` / `.sarif`（SARIF 2.1.0）。JSONLの各行（`scripts/lib/finding.py`）: `id`、`title`、`impact`、`file`、`line`、`description`、`exploit_scenario`、`preconditions`、`category`、`severity`、`confidence`、`recommendation`、`cwe_id`、`snippet`、`symbol`、`declared_line`、`via_change`、`other_cwe_ids`、`claudeSecurityPluginFindingId` | 結果は対象repo内の`CLAUDE-SECURITY-<timestamp>/`へ書き出す。読み取り専用のTarget Snapshotには書けないので、作業copyが要る | — |
| 言語対応 | そのまま | `workflows/scan.js`はPHPをmanaged languageと判定し、`memory-and-unsafe`のlensを省く。その他のカテゴリは`injection-and-input`、`auth-and-access`、`crypto-and-secrets`で固定 | WordPress固有の観点はない。カテゴリ×componentの固定matrixは、固定役割を持たない本repositoryの方針と異なる | — |
| ライセンス | 使えない（他社モデルの腕への転用、改変版の共有） | LICENSE: 「proprietary」。「install, run, and modify the Plugin for your internal use, solely with Claude Code or other Anthropic products」。禁止事項は「(a) distribute ... (b) use the Plugin or any part of it with, or to develop, any non-Anthropic product or service」 | verifier promptをGrok / Codexの腕へ流用することはできない | Anthropic Commercial / Consumer Termsに従う |

### Anthropic `defending-code-reference-harness`（`d3bea6b`、保守終了）

以下の根拠リンクの基点は`https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/`。

| 部品 | 分類 | 根拠（一次資料, 日付） | WordPress / PHPでの注意 | ライセンス・利用条件 |
| --- | --- | --- | --- | --- |
| 保守状況 | — | README「This repo is not maintained and is not accepting contributions」（`81e5081`、2026-05-30から）。最終commitは2026-08-06。理由は書かれておらず、managed productへ誘導するだけ | 追従するupstreamがない | Apache-2.0（`Copyright 2026 Anthropic PBC`。GitHubの判定は`NOASSERTION`だが、本文はApache-2.0） |
| gVisor sandbox + egress proxy | 改造 | `scripts/setup_sandbox.sh`（固定した`runsc`を取得）、`scripts/egress_proxy.py`（CONNECTのallowlist。既定は`api.anthropic.com:443`）、`bin/vp-sandboxed`、`docs/agent-sandbox.md` | 本repositoryには既にrunsc sidecarとegress broker（ADR 0142）がある。比較の参考に留める | Apache-2.0 |
| agentの起動（`docker exec <c> claude -p --output-format stream-json --model ... --tools ... --strict-mcp-config --setting-sources ""`） | 改造 | `harness/agent.py` | Claude Code専用。本repositoryのClaude adapterと同じ型 | 同上 |
| verifier（grade） | 改造 | `harness/prompts/grade_prompt.py`の5基準（PoCが有効、新しいcontainerでcrashが再現、OOM / timeoutではない、project code内のcrash、一貫している） | 「新しいcontainerで再現」の基準は転用できる。crash / ASanの判定はWordPressの種別別canaryに置き換える必要がある | 同上 |
| run status | そのまま（分類の参考として） | `harness/artifacts.py` 154行: `crash_found`、`no_crash_found`、`crash_rejected`、`agent_failed`、`build_failed`、`error`。`novelty_status`は`FIXED` / `UNFIXED` / `UNKNOWN` / `NOT_CHECKED` | 既存noteのとおり、失敗をnegativeへ丸めない点が一致する | 同上 |
| find / report / patch prompt、`asan.py`、`targets/*` | 使えない | `docs/customizing.md`「Where the C/C++ specifics live」 | C/C++とメモリ破壊に固定。`targets/canary`は名前が「canary」なだけで、C言語の3 bugを仕込んだsmoke target | 同上 |

### Google Mantis（`2b3bbdc`）

全skillはharness非依存のMarkdownである。ADK / Gemini / Vertexの名前は例示（`mantis-dedupe`の埋め込みmodel例、`mantis-pipeline-adapter`）にしか出ない。ライセンスはすべてApache-2.0（LICENSE、copyright欄はtemplateのまま）。以下の根拠リンクの基点は`https://github.com/google/mantis/blob/2b3bbdcbb8d259d1777b89dcfa3c8e87615ccc80/`。

| 部品（`<name>/SKILL.md`） | 分類 | 根拠（一次資料, 日付） | WordPress / PHPでの注意 | ライセンス・利用条件 |
| --- | --- | --- | --- | --- |
| `mantis-researcher` | 改造 | `plan.json`の戦略に沿ってfileを深く読む | `plan.json`依存を外し、Rootの判断へ戻す | Apache-2.0 |
| `mantis-review` | 改造 | 統合したfindingをsourceに照らして独立にreviewする | Research内の敵対的確認として転用できる。Candidate Verificationの代わりにはならない | 同上 |
| `mantis-dedupe` | 改造 | 決定的に一致しないものは別IDのまま保つ（fail-closed）。埋め込みの例は`vertex_ai/gemini-embedding-001` | 本repositoryはCampaignをまたぐ自動統合をしない。Campaign内の表示補助に限る | 同上 |
| `mantis-reproduce` | 改造 | Tier 1（micro-harness）→ Tier 2（subsystem）→ Tier 3（「Full Sandboxed Service / E2E ... inside the isolated sandbox (Docker, QEMU, VM)」）。Tier 1 / 2だけでは`reproduced`を出さない。crash向けの記述が多い（C系の語が15箇所） | Tier 3を「新しいWordPress Lab + 実際のHTTP interface」に、crash判定を種別別canaryに置き換える。Labそのものは提供しない | 同上 |
| `mantis-chain` | 改造 | 低重大度のfindingを組み合わせて連鎖を作る | 高影響への昇格経路（Parked Programme Leadの昇格）に対応する | 同上 |
| `mantis-calibrate` | 改造 | 実証の証拠と影響からriskを算出する | programmeごとの重大度表との対応は別に要る | 同上 |
| `mantis-report` | 改造 | stakeholder向けの報告packet | Submission Draftの雛形にできる。提出は人間ゲート | 同上 |
| `mantis-threat-model`、`mantis-architecture`、`mantis-summarize` | 改造 | KB / threat model / directory要約を作る | 過去の脆弱性を入力しない運用なら、oracle-freeを保てる | 同上 |
| `mantis-structural-index` | 改造 | tree-sitter / ast-grep / SCIPがあればASTを、なければheuristicを使う。言語別のsemantic unit | PHPはtree-sitterがあればAST精度になる。補助に限り、探索空間や完了の証明にしない | 同上 |
| `mantis-critic` | 改造 | release build / assertion無効での成立を確認する（compiled向け） | WordPressでは`WP_DEBUG`等の設定依存の確認へ読み替える必要がある | 同上 |
| `mantis-patch` | 使えない（範囲外） | patchの適用と検証 | 本製品は修正を作らない | 同上 |
| `mantis-history` | 使えない | VCS履歴から過去の脆弱性を抽出し、`historical_learnings.jsonl`を作る | 既知脆弱性をResearchへ渡す。oracle-freeと衝突する | 同上 |
| `mantis-advise` | 使えない | 「historical vulnerability lineages」「triaged false positives」を照会する | 同上の理由に加え、過去の判断を流入させる | 同上 |
| `mantis-reflect`、`mantis-meta-agent` | 使えない | `learnings.jsonl`へtrajectoryの学習を追記する。永続supervisorを持つ | 試行をまたいで学習が流れ、独立試行と衝突する。固定の進行管理にもなる | 同上 |
| `mantis-plan` | 使えない | `workspace/plan.json`のroadmapを作る | Harness状態としての計画は、固定段階を持たない方針と衝突する | 同上 |
| `mantis-pipeline-adapter` | 使えない（参考のみ） | 独自のharnessを設計する対話ガイド | 実行部品ではない | 同上 |
| `reference/`（ADK harness） | 使えない（土台にしない方針） | `google-adk==2.9.1`、`litellm`経由。READMEは「USE ONLY IN ISOLATED, RESTRICTED ENVIRONMENTS」 | Issue #221の決定どおり参照に留める | 同上 |

### Cloudflare `security-audit-skill`（`c1c8a8c`）

以下の根拠リンクの基点は`https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/`。

| 部品 | 分類 | 根拠（一次資料, 日付） | WordPress / PHPでの注意 | ライセンス・利用条件 |
| --- | --- | --- | --- | --- |
| `SKILL.md`（6段階、Parent / Task toolの抽象） | 改造（採用済み） | 「This skill is agent-neutral」。「Universal execution safety」はnetworkなし、空の環境、read-onlyのtarget、資源上限を要求し、満たせなければ実行しない | 既に`cloudflare` / `cloudflare-upstream`の探索方式として、digest付きで使っている（`src/research/agent-led/research-methods.ts`） | MIT（`Copyright (c) 2025-2026 Cloudflare, Inc.`） |
| `RECONNAISSANCE.md`、`HUNTING.md`、`VALIDATION-AND-REPORTING.md` | 改造（採用済み） | coverage ledgerとcritic wave | 前回runの`findings.json` / `coverage-ledger.json`の引き継ぎ（`SKILL.md` 92行〜）とprior-run gapの優先（`HUNTING.md` 7行）は、独立試行では無効にする | MIT |
| companion: WEB-PROTOCOL-AND-AUTH、ATTACK-CLASSES、DATA-ISOLATION-AND-LIFECYCLE、CLIENT-SIDE、SUPPLY-CHAIN-AND-RELEASE、RESOURCE-EXHAUSTION-AND-AVAILABILITY | そのまま | 言語非依存の観点集。PHP / WordPressの語は出てこない | WordPress固有のnonce / capability / REST permission_callbackは、本repositoryのpromptで補う | MIT |
| companion: MEMORY-SAFETY-AND-BINARY、DESKTOP-MOBILE-AND-LOCAL-IPC、PROTOCOLS-RPC-AND-MESSAGING、CLOUD-AND-DEPLOYMENT、AI-AND-LLM | 使えない（大半）/ 改造（AI-AND-LLM） | 対象の種類が異なる | AI機能を持つpluginにだけ、AI-AND-LLMが関係する | MIT |
| `report-schema.json`、`validate-findings.cjs`、`validate-coverage-ledger.cjs` | 改造 | skill自身のschema検証。対象のコードではない | 既存noteの判断どおり、Zod schemaを正本とし、直輸入しない | MIT |

## 自作が必要な部分の確認

| 部品 | 大手が同等品を出しているか | 判定 |
| --- | --- | --- |
| WordPress Lab（WordPress + MySQLの使い捨て隔離環境） | **出していない（Observed）。** Codex Security Cloudの「ephemeral Codex container」は汎用の`codex-universal`で、PHPはあるがMySQL serverはない。対象は接続済みGitHub repoに限られる。ローカルCLIのcustom validationは、利用者のscriptを呼ぶ差し込み口だけ。Mantisの`mantis-reproduce`のTier 3は「Docker, QEMU, VM」と書くだけで、環境は提供しない。Anthropicのreference harnessは対象ごとのDockerfileを要求し、例はC/C++だけ。Claude Security pluginは実行しない | 自作（既存の`gvisor-wordpress-dynamic-reproduction.ts`を維持）。Codex Securityのcustom validationからこのLabを呼ぶ配線は**Inference上可能**だが、人間ゲートの順序と衝突する |
| 種別別canary判定器（nonce付きExecution Canaryなど） | **出していない（Observed）。** 公開されている判定器はASan（Anthropic）、crash（Mantis）、LLMが書く`CustomValidationResult`（Codex）、read-onlyの投票（Claude Security）である。XBOWのcanary（[既存note](pipeline-reference-designs-2026-10-08.md)）は製品が非公開 | 自作。現行の`src/`には`canary`の実装がなく、recipeの`effectObserved`は自己申告（Observed）。ここが5部品の中で唯一、新しく作る必要がある部分（Inference） |
| Programme Boundary / scope評価 | **出していない（Observed）。** 最も近いのはCodex Securityの`SECURITY.md` policy（「reportable finding criteria, exclusions, and severity context」）とCloudflareの「review scope」。どちらもrepository所有者の方針で、bug bountyプログラムの対象範囲（複数プログラムの独立評価、`in-scope` / `out-of-scope` / `ambiguous` / `stale`）を扱わない | 自作（既存のHuman OS v3とProgramme Intelligenceを維持）。`SECURITY.md`形式は、Programme Research Boundaryを探索へ渡す表現として**設定で**流用できる（Inference） |
| 既知脆弱性を渡さない評価 | **出していない（Observed）。逆向きの部品が多い。** Mantisの`mantis-history` / `mantis-advise`は過去の脆弱性を入力する。Codex Securityのfalse-positive feedbackと、Cloudflareのprior-run carryは、過去の判断を入力する。Codex Securityのcore scanはgit historyを読まない（`core-scan.md` 9行）ので、無効化しやすい側にある | 自作（independent trialのbinding、fresh state）。Codex Securityを使う場合は、試行ごとに`CODEX_SECURITY_STATE_DIR`を空にする設定が必須（Inference） |
| 提出フロー（Submission Candidate、Draft版、External Action Authorization） | **出していない（Observed）。** Codex Securityの`vulnerability-writeup`は文案の作成までで、publishの送信先はCloud / Linear / findings service。Claude SecurityとAnthropic harnessはpatchとmaintainer向けの開示の心得（`docs/best-practices.md`）まで。Mantisは`mantis-report`まで。Wordfence / Patchstackへの提出と、版・送信先に結び付いた承認を扱うものはない | 自作（既存のHuman OS v3を維持）。`vulnerability-writeup`は文案作成の補助として**改造**で使える（Inference） |

## 未解決の問い

Issue #238（土台の決定）が必要とするが、本調査では決められなかったもの。

1. **Codex Securityの規約上、bug bountyプログラムの許可で第三者のWordPress pluginをscanしてよいか。** 公式docsの文言は「own or have permission to assess」「explicitly authorized」だけである。Wordfence / Patchstackの規約がこの許可に当たるかは、OpenAIのTerms / Usage Policies本文（未読）と各プログラムの規約を照らして、人間が判断する必要がある。
2. **Codex Securityの中で、Rootの`continue`と、ルート込み最大4体の上限を再現できるか。** multi-agentの上限はparent + 8 threadで、`features.multi_agent_v2.max_concurrent_threads_per_session`で変えられる。deep scanのworker / 停止規則は別の層にある。実行による確認はしていない。
3. **Codex SecurityがOpenAI以外のmodel（Grok、GLM、DeepSeek）で、どこまで動くか。** provider設定はdocsにある。plugin / MCPのtoolとmulti-agent v2が、各providerのResponses API互換層でそのまま動くかは未確認。
4. **SDKのprereleaseのCodex依存をどう固定するか。** `@openai/codex-security` 0.2.0は`@openai/codex` `0.162.0-alpha.18`に依存する。本repositoryのRuntimeProfileは0.146.0に固定している（[Sol / Luna note](sol-luna-runtime-profile-2026-10-08.md)）。包む場合、`codex-native/v1`とは別のtransportとして版を固定する設計が要る。
5. **custom validationを人間の採否より前に置くか。** 既存noteの推奨（自動の新環境検証をHuman Candidate Reviewの前へ移す）を採るなら、Codex Securityのcustom validationでLabを呼ぶ形が候補になる。その場合も、(a) LLMが結果を解釈する、(b) `suppressed`が`contradicted`と`incomplete`を区別しない、という2点を写像規則で補う必要がある。ADR 0135の変更を伴う。
6. **Claude Securityの腕を比較用に残すか。** ライセンス上、Claude Codeの中で内部利用する範囲に限られる。verifierは実行時の検証をせず、未検証の候補を捨てる。評価の腕として残す価値があるかは、#238で判断する。
7. **種別別canary判定器の範囲。** どの種別（RCE、SQLi、格納型XSS、権限昇格、任意file読み取り）から決定的な判定器を作るかと、XBOWのcanary方式（fileやDBに置いたcanaryを取得させる）との対応は、本調査の範囲外である。
