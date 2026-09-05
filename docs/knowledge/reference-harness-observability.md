# Knowledge: reference harness observability

Status: implementation-checked external reference, 2026-09-05

## Scope

比較対象は公式の公開sourceに限定した。

| Harness | Repository snapshot |
| --- | --- |
| Anthropic | [`anthropics/defending-code-reference-harness`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145), `d3bea6b5793b5f3d59a75ebe69a58efa88383145`, 2026-08-06 |
| OpenAI Codex Security | [`openai/codex-security`](https://github.com/openai/codex-security/tree/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2), `f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2`, 2026-09-04 |

OpenAIは公開repositoryが存在するため、installed plugin artifactのLOCをrepository LOCの代用にはしていない。

## Implementation comparison

| Concern | Anthropic reference harness | OpenAI Codex Security |
| --- | --- | --- |
| Live progress | [`agent.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L113-L132)がtool名と主要argumentまたはtext previewをstderrへ出し、25 assistant messagesごとにheartbeatを出す。`cli.py`はphase開始、完了時間、message数、resume回数を表示する。 | [`cli.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/cli.ts#L6746-L7005)がinteractive dashboardとplain progressを切り替え、phase、worker数、reviewed files、token、estimated cost、retry reasonを表示する。[`worker-progress.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/worker-progress.ts)と[`deep-progress.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/deep-progress.ts)がworker phaseと独立reviewの進捗をtyped stateとして扱う。 |
| Debug/event log | [`agent.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L294-L358)がClaude `stream-json`を到着時にraw JSONL transcriptへ追記する。tool resultはサイズ制限だけで、内容redactionではない。 | [`scan-logs.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/scan-logs.ts)がrootとchild workerのCodex session JSONLを関連付けてsaved eventsを再構成する。`--verbose`は[`cli.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/cli.ts#L6567-L6597)のstructured lifecycle diagnosticsをstderrへ出す。公式CLI referenceも[`scans logs`](https://learn.chatgpt.com/docs/security/cli/reference#codex-security-scans-logs)を「redactされない完全なsaved session events」として区別する。 |
| Persisted state/artifacts | transcript、`result.json`、`found_bugs.jsonl`、`focus_areas.json`、reportを段階的に保存する。[Pipeline docs](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#watching-a-run)はfailed/killed runでもtranscriptが残るとする。 | Workbench SQLiteがscan status、monotonic progress、artifact path、cost/historyを保持する（[`workbench_schema.py`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/plugins/codex-security/scripts/workbench_schema.py#L34-L81)、[`workbench_progress.py`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/plugins/codex-security/scripts/workbench_progress.py#L156-L314)）。canonical terminal bundleはmanifest、findings、coverageで、stopped runもpartial artifactsを保持する（[`scan-contract.md`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/plugins/codex-security/references/scan-contract.md#L1-L48)）。 |
| Token/cost | raw transcriptの各turnに`usage`が残るが、reference implementationにrun全体のtoken/cost集計またはcost UIはない。docsはrate-limit sizingの目安を示すだけである。 | session JSONLをpollしてroot/child usageを集計し、input、cached input、output、estimated USDをlive表示・結果保存する。cost limitはestimateで、超過時にもpartial outputを保持する（[`api.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/api.ts#L981-L1123)）。 |
| Interrupt/replay | transient failureは同じClaude sessionを最大20回`--resume`する。batch resumeはterminal runをskipしてfailed/nonterminal runを再試行する。`error_max_turns`は意図的にterminal（[`agent.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L268-L280)、[Pipeline docs](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/pipeline.md#resume-on-error)）。 | [`cli.ts`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/cli.ts#L6607-L6641)は最初のsignalでgraceful abort、次のsignalでforce exitを行う。Deep worker checkpointはretry、cancel、failureを跨いでimmutableに保持される（[`scan-artifacts.md`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/plugins/codex-security/references/scan-artifacts.md#L39-L47)）。 |
| Sensitive data | raw transcriptを保存する。sandbox、egress、credential mount制限が主なboundaryである。 | verbose diagnostics/persisted failureは[`safeErrorMessage`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/sdk/typescript/src/errors.ts#L8-L24)を使う一方、live session detailsと`scans logs`はrawである。[`SECURITY.md`](https://github.com/openai/codex-security/blob/f2ec53dcc93ce8e3d9b322c6d9bd3c9d8724bdf2/SECURITY.md#L53-L105)はprivate stateをOS accountと別のsecurity boundaryとは扱わず、不要なenvironment credentialを渡さないよう求める。 |

Anthropicのdurability説明には実装差がある。module docstringと`run_agent` docstringは各messageを`fsync`すると記すが、確認した実装は[`write()`後の`flush()`だけ](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/agent.py#L340-L347)であり、repository内に`os.fsync`呼び出しはない。process kill後に読み取り可能であることと、power lossまで耐えるdurabilityは同一ではない。

## Harness implication

このHarnessにもdebug observabilityは必要である。採用する最小形は次の分離とする。

- operator progressはCampaign、attempt、role、phase、terminal state、elapsed time、input/cached/output token、estimated cost、durable checkpointだけを表示する。
- providerのraw event/transcriptはprompt改善と研究診断に有用なので、private debug artifactとして保存可能にする。ただしGit外または`.private`配下へ置き、Ledger/CASやFinding contractの代用にはしない。
- replayはdebug logではなくcanonical Ledgerとimmutable artifactから決め、terminal attemptをskipし、nonterminal attemptだけを再開またはfresh retryする。
- observability writerのfailureで研究runを失敗させない。costはまずestimateと診断telemetryとして収集し、探索能力を削るhard budgetの根拠にはしない。

つまり、Anthropicのraw transcriptによる追跡性とOpenAIのtyped progress、cost集計、partial-result recoveryを組み合わせる。ただしEvidenceの正本は引き続きResearch Recordであり、UIやdebug streamではない。

## LOC snapshot

`cloc` 2.06のcode linesを数えた。`Authored repository`はGit tracked filesからdependency、generated bundle、example、asset、target、test fixture、lockfileを除外し、test、docs、skill/prompt instructionは含めた。`Core runtime`は実行pathへ限定し、test、fixture、example、README、data-only JSON/YAML/TOMLを除外した。

| Repository | Authored repository | Core runtime |
| --- | ---: | ---: |
| Anthropic reference harness | 14,040 LOC / 99 files | 4,108 LOC / 37 files |
| OpenAI Codex Security | 223,127 LOC / 551 files | 66,096 LOC / 162 files |

Repository rootで実行した再現commandは次の通り。

```bash
git ls-files \
  | grep -Ev '(^|/)(node_modules|dist|build|coverage|fixtures?|targets|examples?|assets|__pycache__)(/|$)|(^|/)(package-lock|pnpm-lock)\.yaml$|\.pyc$|\.br\.part-[0-9]+$' \
  > /tmp/authored-files.txt
npx --yes cloc --json --list-file=/tmp/authored-files.txt
```

OpenAIのAuthored repository計測だけは上の除外式へgenerated bundle `|^plugins/codex-security/mcp/server\.mjs$`を追加した。Core runtimeは次のpath listで計測した。

```bash
# Anthropic
git ls-files harness dnr_harness scripts bin \
  | grep -Ev '(^|/)(tests?|fixtures?|examples?|assets|__pycache__)(/|$)|(^|/)README\.md$|\.pyc$' \
  > /tmp/core-files.txt
npx --yes cloc --json --list-file=/tmp/core-files.txt

# OpenAI
git ls-files sdk/typescript/src sdk/typescript/dashboard sdk/typescript/bin \
  plugins/codex-security/scripts plugins/codex-security/mcp-app docker \
  | grep -Ev '(^|/)(tests?|tests-ts|fixtures?|examples?|assets|evals?|__pycache__)(/|$)|(^|/)README\.md$|(^|/)(package-lock|pnpm-lock)\.yaml$|\.pyc$|\.br\.part-[0-9]+$|^plugins/codex-security/mcp/server\.mjs$' \
  > /tmp/core-files.txt
npx --yes cloc --json --exclude-lang=JSON,YAML,TOML --list-file=/tmp/core-files.txt
```
