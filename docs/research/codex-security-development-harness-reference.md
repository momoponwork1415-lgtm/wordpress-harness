# Codex Security development-harness reference

- 調査日: 2026-09-01
- 対象: `openai/codex-security`
- 固定commit: [`b1774f58cf4005cf756bb0f30dcde18badce1d43`](https://github.com/openai/codex-security/tree/b1774f58cf4005cf756bb0f30dcde18badce1d43)
- 目的: WordPress Research Harness自体ではなく、それを作るためのDevelopment Harnessの実装参考

## 位置付け

Codex Securityは、TypeScriptのCLI・SDK、Python helper、plugin、npm package、containerを一つの公開repositoryで開発・配布する成熟した実装例である。そのため、coding rule、testの隔離、CIの最小権限、公開前の情報衛生は参考になるが、multi-OS、sharding、mutation、npm/container releaseは現在のこのrepositoryに必要な最小構成ではない。実際にCodex Securityはpublic package、CLI、plugin、scan output、build/release integrityまでを自身のsecurity scopeに含めている。[「Security policy」L21–37](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L21-L37)

このメモは、実装方法と開発運用のreferenceであり、`docs/REFERENCES.md`に固定した3件と同列の**第4の製品設計参照資料ではない**。Codex Securityのproduct architecture、scan lifecycle、threat modelをResearch Harnessの正当化に使わない。

## 結論

| 分類 | このharnessでの扱い |
| --- | --- |
| Adopt now（今採用する） | `AGENTS.md`の最小なDeveloper Contract、Prettierによる一つのformat gate、現実の境界を観測する決定的test、localとCIが共有する`pnpm check`、Ubuntu一jobの最小権限CI、合成fixtureとprivate artifactの公開防止 |
| Defer until observed need（実測するまで延期する） | macOS/Windows/複数Node matrix、test shardingとduration balancing、property testの拡大、coverage floor、mutation testing、devcontainer、PR title/release label automation、package archive検査とnpm provenance |
| Reject / not applicable（非採用・非該当） | Codex Securityの「local userを信頼する」scan threat model、Bunへのtest runner置換、plugin bundle/MCP用source compatibility machinery、Docker/AppArmor/Composeのcustomer container release pipeline、OpenAI固有のBugcrowd受付先 |

## Adopt now（今採用する）

### `AGENTS.md`をDeveloper Contractの正本にする

Codex Securityのルート規則は、repository contents、model output、import artifactを「権限」ではなくdataとして扱い、concrete failureのないlimitやcheckを追加せず、実behaviorの単純なcodeとtestを優先する。[「AGENTS.md」L1–15](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/AGENTS.md#L1-L15) また、仮想的なsanitization、redaction、validation、fallbackを増やさないことを独立規則にしている。[「AGENTS.md」L26–35](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/AGENTS.md#L26-L35)

このharnessでは既存のより強いsecurity・TDD・design gateを維持した上で、欠けている次の規則だけを`AGENTS.md`へ追加するのがよい。

- CLIのcommand、argument、flag、accepted value、public environment variable、defaultをpublic interfaceとし、便宜的なsurfaceを勝手に増やさない。Codex Securityも変更時にhelp、schema、docs、testを同時更新する。[「AGENTS.md」L37–50](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/AGENTS.md#L37-L50)
- private Target、Finding、credentialはexampleやtestでも使わず、synthetic name、repository、fixture、identifier、log、credentialを使う。[「AGENTS.md」L52–78](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/AGENTS.md#L52-L78)
- optionalなlog、progress、cost trackingの故障をmain taskの失敗にしない。一方でuserが固定したbudgetは強制する。[「SDK AGENTS.md」L14–28](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/AGENTS.md#L14-L28)

`CONTRIBUTING.md`は、外部contributorまたは複数の定常workflowが生じるまで作らない。安定規則を2か所で複製する理由がまだない。

### strict TypeScriptを維持し、formatterは一つにする

Codex Security SDKは`strict`に加え、`noImplicitOverride`、`noPropertyAccessFromIndexSignature`、`noUncheckedIndexedAccess`、unused checkを有効にしている。[「SDK tsconfig.json」L13–37](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/tsconfig.json#L13-L37) このharnessはすでに`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を持っており、Codex Securityのconfigへ置き換えるのではなく現行のほうを維持する。

現在欠けているのは決定的なformat gateである。Codex SecurityはPrettierの`--check`を単一の`format` commandとし、typecheckと別のscriptにしている。[「SDK package.json」L43–61](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/package.json#L43-L61) このharnessもPrettier一つを導入し、同じ役割のESLint、Biome、dprintを重ねない。大量の既存ADRまで初回に機械formatせず、まずauthored codeと機械可読設定をscopeにする。

### behaviorと現実の境界をtestする

Codex Securityのtest規約は、observable result、accepted/rejected input、実際のbugまたはsecurity boundaryを小さくtestする。network、real credential、shared state、timing-sensitive assertion、Markdownの完全一致を避け、決定的fixtureと合成credentialを使う。[「SDK AGENTS.md」L30–39](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/AGENTS.md#L30-L39)

境界の内部をmockで再実装せず、必要な場合はreal temporary directory、Git repository、SQLite database、installed packageを使う。production abstractionをmockのためだけに追加しない。SQLiteのmigration、reopen、locking、crash recoveryはfile-backed databaseでtestする。[「SDK TESTING.md」L47–74](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L47-L74) これはこのharnessのLedger replay、crash境界、filesystem、subprocessのtest方針と一致する。

なお、Codex Security自身もcoverageを現在はdiagnosticとし、複数回のCIからbaselineを得る前にcoverage floorを設けない。[「SDK TESTING.md」L39–45](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L39-L45) このharnessでもinterface scenarioの合否をpercentageに置き換えない。

### localとCIに一つのquality gateを公開する

Developerとcoding agentが使う全体gateは`pnpm check`一つとし、`format:check -> typecheck -> test -> build -> docs:check`を実行する。CIは判定を再実装せず、fresh checkoutで同じcommandを呼ぶ。Codex Securityではformat、typecheck、test、package checkが複数のscriptとjobに分かれているが、それは大きなpackageの実行時間とOS matrixに対応した現在地であり、最初からコピーするinterfaceではない。Codex Securityの最小な一連のlocal check自体は、frozen lockfile installからtypecheck、test、format、packへ進む。[「SDK TESTING.md」L1–19](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L1-L19)

### 最初のCIはUbuntu一jobにする

Codex Security CIから直ちに取り入れるのはjob数ではなく、次の制御である。

- workflow全体の`contents: read`、PRごとのconcurrency、`cancel-in-progress`を持つ。[「node-ci.yml」L9–15](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L9-L15)
- Actionはfull commit SHAへ固定し、release versionをcommentで残す。checkoutの`persist-credentials`を`false`にする。[「node-ci.yml」L123–153](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L123-L153)
- repositoryのpackage managerとNode versionを固定し、`--frozen-lockfile`でinstallする。[「node-ci.yml」L134–151](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L134-L151)
- job timeoutを明示する。[「node-ci.yml」L123–129](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L123-L129)

このharnessの初期workflowは、Ubuntuで`pnpm install --frozen-lockfile`と`pnpm check`だけを行う一jobにする。markdown-only skip、cache tuning、CI専用test branchは入れない。

### securityとdisclosure hygieneを開発artifactにも適用する

Codex SecurityはPR公開前にbranch name、title、description、commit、changed files、comment、log、screenshot、attachment、linkを検査し、credential、private source、scan target、Finding、未公開脆弱性、nonpublic linkを公開しない。[「AGENTS.md」L52–78](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/AGENTS.md#L52-L78) また、scan state、Finding、report、log、SARIFをGit worktree外に保存し、最小のcredentialだけを渡すことを安全運用としている。[「Security policy」L197–210](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L197-L210)

このharnessも既存のGit外private artifact方針を維持し、test、CI artifact、Issue、PRにはsynthetic fixtureだけを入れる。外部へ公開するPR workflowを整える段階ではCodex SecurityのPR templateのように、実行check、risk、公開情報のattestationを明示するとよい。[「Pull request template」L3–25](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/PULL_REQUEST_TEMPLATE.md#L3-L25)

## Defer until observed need（実測するまで延期する）

### multi-OSと複数Node version

Codex SecurityはLinux/macOSの3 shard、Windowsの7 shard、複数Node versionのinstalled-package verificationを持つ。[「node-ci.yml」L202–287](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L202-L287) [「node-ci.yml」L425–530](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-ci.yml#L425-L530) これは一般原則ではなく、同projectがWindowsとUnixの公式supportをDeveloper Contractに置いているためである。[「SDK AGENTS.md」L26–39](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/AGENTS.md#L26-L39)

このharnessはまずNode 22/Linuxを開発platformとする。Model Transportのprocess-tree cleanup、path、signal、credential storageでOS固有failureを観測した時、または配布support範囲を明示する時だけ、該当OSとNode versionのlaneを追加する。

### sharding、duration balancing、runner comparison

Codex Securityは測定したtest fileの実行時間を保存し、長いfileからshardへ割り当てる。[「SDK TESTING.md」L98–110](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L98-L110) さらにweeklyのtest-quality workflowでbaseline、isolation、parallel、Windows 7-way shardingのtest identity・outcome・timingを比較する。[「test-quality.yml」L1–10](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/test-quality.yml#L1-L10) [「test-quality.yml」L22–61](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/test-quality.yml#L22-L61) [「test-quality.yml」L107–131](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/test-quality.yml#L107-L131)

このharnessでは全testがCI time budgetを超える、または明確な長尾fileでdeveloper feedbackが悪化するまで入れない。その時もdurationは割当てにだけ使い、test omissionの理由にしない。

### property test、coverage floor、mutation testing

Codex Securityはmeaningful invariantにproperty testを使い、読みやすいfailureにexample-based regressionを残す。[「SDK TESTING.md」L73–83](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L73-L83) またmutation testingは限定したpure moduleのtrialで、score gateもまだ置いていない。[「SDK TESTING.md」L140–152](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L140-L152)

このharnessでは、stable ordering、canonical JSON、event replay等の意味のあるinvariantがexample testで安定した後だけproperty testを足す。coverage floorとmutationは、interface scenarioが充実し、数回のbaselineと具体的な取り逃しが観測されるまで延期する。

### devcontainer

Codex Securityのdevcontainerはuniversal imageを指す最小な2-field設定だけであり、それ自体がtoolchainの再現契約ではない。[「devcontainer.json」L1–4](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.devcontainer/devcontainer.json#L1-L4) このharnessはpackage manager、lockfile、Node version、`pnpm check`で先に再現契約を作る。onboarding、host差、PHP/SQLite dependency setupで実故障が出るまでdevcontainerは追加しない。

### release、package archive、provenance、PR automation

Codex Securityはpublic npm packageとCLIを配布するため、pack時のplugin generation、archive contents検査、installed-package smoke testを持つ。[「SDK TESTING.md」L21–34](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/TESTING.md#L21-L34) releaseは、CI済みの正確なcommitへのtagを作り、locked dependency graphをtest/packし、npm provenanceとGitHub releaseまで照合する複数workflowである。[「RELEASING.md」L63–82](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/RELEASING.md#L63-L82) publication jobはOIDC用に`id-token: write`を狭く与え、検査済みartifactを別jobで受け取る。[「node-release.yml」L227–308](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/node-release.yml#L227-L308)

このharnessは`package.json`が`private: true`で、npm packageやcustomer containerの公開配布contractがない。そのためpackage archive、provenance、release tag、release notes、PR title validator、release label automationは配布を決定するまで延期する。将来導入する場合は、Codex Securityの「検査した一つのartifactを配布し、tag・package identity・provenanceを照合する」構造を改めて参考にする。

### `SECURITY.md`とpublic disclosure workflow

Codex Securityは自身の脆弱性はOpenAI Bugcrowdへprivateに報告し、別projectのFindingはそのprojectのsecurity policyに従うと分けている。[「Security policy」L7–19](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L7-L19) [「Security policy」L190–195](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L190-L195)

このharnessではHuman OSのExternal Action AuthorizationとTarget側のpolicyがすでに外部行動を所有する。repository自体の公開、外部contributorの受入れ、配布versionのsupport範囲が決まった時点で、harness自体のprivate reporting channelだけを`SECURITY.md`へ定義する。OpenAI Bugcrowdの連絡先は当然コピーしない。

## Reject / not applicable（非採用・非該当）

### Codex Securityのlocal trust modelを持ち込まない

Codex Security CLIはcurrent OS userで動き、local toolやsubprocessを別security principalとみなさず、信頼してpermissionを持つrepositoryだけをscanする前提である。[「SDK AGENTS.md」L6–12](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/AGENTS.md#L6-L12) [「Security policy」L39–68](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L39-L68) また、baseline filesystem profileはlocal filesystemのreadとworkspace/scan stateへのwriteを認め、subprocessが一部のambient credentialをinheritし得ることも明記する。[「Security policy」L70–90](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/SECURITY.md#L70-L90)

このharnessのTarget sourceはuntrusted inputであり、Target codeをhostで実行せず、Agent SandboxとVerification Labを別trust zoneにし、credentialをmodel-visible環境へ置かない。したがって、Codex Securityの「root read + workspace writeで十分」、「local processは同一principal」というproduct-specific前提を製品設計へ取り入れない。ここは設計の差であり、Development Harnessのease-of-useで緩めてよい境界ではない。

### test runner、plugin bundle、MCP machineryを置き換えない

Codex Security SDKはBun test、生成plugin payload、別MCP appを一つのpackageとして検査するため、buildでpluginを生成してからBun suiteとMCP testを実行する。[「SDK package.json」L43–61](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/sdk/typescript/package.json#L43-L61) このharnessはすでにVitestでbehavior testを持ち、製品にCodex plugin bundleまたはMCP appを内包しない。Bunへの置換、plugin source compatibility checker、MCP test runnerは課題を解かないため採用しない。

### customer container release pipelineをDevelopment Harnessにしない

Codex Securityのcontainer releaseはamd64/arm64のnative imageをbuildし、CLI、non-root user、AppArmor/Landlock、seccomp、Git credential helper、Compose、persistent findings serviceまでcustomer artifactとして検査する。[「container-release.yml」L29–80](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/container-release.yml#L29-L80) [「container-release.yml」L117–163](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/container-release.yml#L117-L163) [「container-release.yml」L175–238](https://github.com/openai/codex-security/blob/b1774f58cf4005cf756bb0f30dcde18badce1d43/.github/workflows/container-release.yml#L175-L238)

このharnessのAgent SandboxとVerification Labはproduction security boundaryであり、Development Harnessと別の設計対象である。Codex Securityのcustomer Docker/Compose distribution pipelineはコピーしない。将来Lab imageのdistribution contractが定まったら、gVisor必須、digest固定、non-evidentiary fallback禁止というこのharness独自のaccepted designからCIを設計する。

## 最初の実装に引く順序

1. 既存`AGENTS.md`へpublic CLI compatibility、synthetic fixture、non-speculative defenseの不足分だけを追加する。
2. Prettierとrepository-owned `docs:check`を追加し、現行の`pnpm check`から実行する。
3. Ubuntu一jobのGitHub Actionsを追加し、fresh checkoutで`pnpm install --frozen-lockfile`と同じ`pnpm check`を呼ぶ。
4. その後の実際のfailureをissue化し、OS lane、sharding、property/mutation、coverage、releaseのいずれかを追加する根拠にする。

この順序はproduction moduleのDesign gateを緩めない。Development Harnessの`pnpm check`がgreenであることは、未acceptedのpublic seamやproduction behaviorを実装してよいことを意味しない。
