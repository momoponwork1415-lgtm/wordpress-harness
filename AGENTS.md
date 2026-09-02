# Repository development rules

このファイルはrepository全体に適用する、長期的に安定した開発規則である。Codexのinstruction discoveryは[OpenAIのAGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)に従う。subtree固有の規則が実際に必要になるまでは、nested `AGENTS.md`を作らない。

## Mission and required reading

- North Starは、oracle-freeなprospective CampaignでRCEまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立VerificationとHuman Confirmationまで到達すること。
- 作業前に[Documentation Guide](docs/README.md)と[Codebase Guide](docs/CODEBASE-GUIDE.md)から現在の実装、対象Module、公開Interface、Test、正本となるSeamを特定する。変更対象contextの`CONTEXT.md`とSeamを読み、system全体の判断が必要な場合だけ[architecture](docs/design/architecture.md)、理由の確認が必要な場合だけSeamから直接linkされたADRを読む。全ADRの通読を前提にしない。
- agentic harness全体の設計参照資料は[docs/REFERENCES.md](docs/REFERENCES.md)の3件とする。個別のsecurity methodologyは一次資料を補助根拠にできるが、外部資料が直接支持する主張とharness固有の推論を分け、3件と同列の第4の設計参照資料にしない。Codex文書やtool文書は開発手順の参考として扱う。
- `CONTEXT.md`、code、Issueでは英語のdomain termとcode identifierを正式語として使う。user向け説明は日本語で書き、必要に応じて「正式語（日本語の意味）」を併記し、[日本語用語早見表](docs/JAPANESE-GLOSSARY.md)から意味を確認できるようにする。
- Mermaid図の箱には短い正式語だけを置き、長い日本語説明、制約、例は図の直下へ出す。GitHub上で文字が見切れる長さのlabelを作らない。

## Architecture

- 最上位の設計原則は`confine -> constrain -> focus -> motivate -> parallelize -> hypothesize -> verify -> record -> prioritize -> iterate`の10語とする。各原則は所有module、永続artifact、観測可能なgateへ具体化する。
- 初期systemはstrict TypeScriptのmodular monolithとし、`Target Intelligence -> Research -> Human OS`をprimary result flowとする。feedbackは公開contractを介し、context内部への逆向き依存を作らない。
- context間では不変かつversionedなcontractだけを渡す。別contextのstorage、内部module、provider objectを直接参照しない。
- `Target Intelligence`は選定と取得を所有し、oracleを除いた`Target Intake Packet`だけを`Research`へ渡す。
- `Research`は探索だけでなく、独立Verification、記録、優先順位付け、反復を所有する。Verificationを任意の後処理にしない。
- Explorationはraw sourceから独立Approach Familyを育て、型付き成果物だけをWave barrier後にChain Synthesisする。LaneとStrategyは観測labelまたは開始lensに限り、Finderの手順または探索範囲にしない。worker間chat、model多数決、vulnerability class別agentを探索多様性の根拠にしない。
- `Human OS`は人間のreviewと判断を所有する。Researchの事実を変更せず、digest固定した`Human Review Packet`への判断を追記する。
- CLI、将来のweb UI、remote controlはadapterであり、domain policyまたはlifecycleを所有しない。
- moduleは小さなinterfaceの背後に複雑さを隠す。二つ目の現実のadapterがない段階で汎用portやrepository abstractionを作らない。

## Change discipline

- 一回の変更は一つの観測可能なbehaviorまたは一つの明確な文書判断へ絞る。将来用のframeworkや未使用の設定を先回りして追加しない。
- public CLIのcommand、argument、flag、accepted value、environment variable、defaultは互換性を持つInterfaceとして扱い、変更時はhelp、runtime schema、Behavior Testを同じ変更で更新する。
- 実在するfailureまたはsecurity propertyに根拠がないsanitization、fallback、limit、abstractionを推測で追加しない。
- North Starへ直接寄与する探索、Source Mapping、Verificationを優先する。UI、notification、multi-user、運用自動化は、安全隔離とevidence integrityに必要な最小限を除き、実戦で観測した故障をissue化して直す。
- hard-to-reverse、文脈なしでは意外、実在するtrade-offの3条件を満たす判断だけADRにする。既存ADRの歴史を書き換えず、新しいADRでsupersedeする。
- domain termが変わったら該当`CONTEXT.md`と[日本語用語早見表](docs/JAPANESE-GLOSSARY.md)を同じ変更で更新する。`CONTEXT.md`へ実装詳細を置かない。
- Module ownership、公開Interface、production status、主要な実装pathまたはBehavior Testの対応が変わったら[Codebase Guide](docs/CODEBASE-GUIDE.md)を同じ変更で更新する。Guideへ内部helperや詳細仕様を複製しない。
- 外部入力、event、artifact、prompt、Model Profileはversionとprovenanceを持ち、runtime schemaでdecodeする。
- clock、ID、randomness、provider response順をdomain判断へ暗黙に混ぜない。再現可能な入力とstable orderingを使う。
- deterministic source fact、model推論、未解決gapを同じ真偽値へ潰さない。modelは観測済みfactを変更できず、追加relationはsourceまたは版付きKnowledgeの根拠を持つ。未解決のcode identifierは既存Evidence Route schemaと同じ`unknown`を使う。

## Documentation discipline

- 文書の分類と更新責任は[Documentation Guide](docs/README.md)に従う。現在の実装状態、file path、Behavior Test対応は`docs/CODEBASE-GUIDE.md`だけへ置き、Seam、architecture、module設計へ複製しない。
- Seam文書はInterface、不変条件、所有state、許可依存、禁止依存、failure semantics、acceptance scenarioだけを扱う。実装version、LOC、run時刻、Target別成否、現在の未実装一覧、次Issueの作業順を書かない。
- 実Targetの成否と時系列は日付付き`docs/experiments/`、完成度snapshotは`docs/audits/`へ置き、既存fileを後日のcodeへ追随させない。
- 完了Goal、旧baseline、旧実装図は`docs/history/`へ凍結し、active designまたは通常のreading pathから参照しない。固有の判断または証拠が他の正本へ残っていれば削除できる。
- 次の有限work、受入条件、作業順はGitHub Issueへ置く。作業日誌をdesignへ転記しない。
- hard-to-reverseな判断だけADRへ置く。ADR本文は実装追随で書き換えず、判断変更は新ADRでsupersedeする。
- code変更で文書更新が必要なのは、公開Interface、Module ownership、domain term、CLI Interface、security invariant、正本status tableが変わる場合だけとする。private helper、内部file、局所algorithmの変更を文章で再現しない。

## Design gate

- 新しいmoduleまたはMilestoneのproduction codeへ入る前に、owner context、公開seam、所有state/artifact、許可依存、禁止依存、failure semantics、受入scenarioを設計文書へ`proposed`として記録する。
- production設計の重要なbehaviorは、一次資料で確認したreference implementation、公開標準またはsecurity invariant、再現可能なlocal experimentの少なくとも一つへ結び付ける。設計文書は、外部資料が直接支持する部分、本harnessへのadaptation、まだ未検証の選択を分ける。根拠がない新規案は`accepted`にせず、反証条件を持つprototypeまたはablationを先に行う。可逆な内部helper、命名、機械的refactorへ形式的な出典を要求しない。
- roadmapまたは高水準architectureへの同意を、個別module設計への同意と読み替えない。userが設計を確認して`accepted`となるまでproduction codeを書かない。
- 設計を提示した同じturnで、明示的な実装指示なしにproduction codeへ進まない。mechanical scaffold、調査fixture、文書だけはこのgateの対象外とする。
- 既存codeがacceptedなmodule mapと一致しない場合は、次の機能を足す前に差分と移行順を示す。互換性を保つ段階的refactorを優先し、全面rewriteを既定にしない。

## Test-driven development

- 新しいbehaviorはred -> greenを一つのvertical sliceずつ進める。mechanical change、文書、test/build scaffoldを除き、先に失敗するtestを作る。
- 新しいtest surfaceを作る前に、public interfaceとtest対象のseamを設計文書へ明記し、userと合意する。testはそのseamからだけ観測する。
- private method、内部call count、内部module同士の呼出順、直接database queryでbehaviorを検証しない。
- expected valueはspecification、固定fixture、worked example等の独立した根拠から作り、implementationと同じ計算をtest内で再実装しない。
- mockはprovider CLI、clock、filesystem等のsystem seamだけに使う。所有する内部moduleはmockせず、可能ならreal local substituteを使う。
- fixtureは合成データを使い、private target、未公開Finding、credentialをTest、Issue、PR、CI artifactへ入れない。
- Target名、version、mechanism、探索成否を結び付けた実験結果は、対応CVEが公開済みの場合だけGit管理下へ置く。未公開または審査中のFindingはGit外のprivate artifactに残し、commit message、Issue、fixture、CI出力にも含めない。[ADR 0115](docs/adr/0115-publish-only-public-cve-experiment-results.md)に従う。
- refactorはgreenになったsliceのreview段階で行い、behavior変更と混ぜない。
- Ledger replay、crash境界、unknown event version、stable work ordering、minority Hypothesis保持、Boundary Pairのpositive/negative/controlは回帰testを必須とする。

## TypeScript and PHP

- TypeScriptは`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を維持する。
- `any`、unchecked type assertion、non-null assertionをvalidationの代用にしない。versioned discriminated unionとexhaustive checkingを使う。
- PHPはpinned `nikic/PHP-Parser` helperに限定し、Campaign lifecycleまたは正本stateを所有させない。
- target PHP、target autoloader、target Composer script、WordPress bootstrapをsource analysisのためにhost上で実行しない。
- Pythonは短命な補助解析に限る。Goは測定されたprocess supervisionまたはCPU bottleneckが生じた時に再評価する。

## Security and evidence

- 受入sourceは信頼しない。元配布物をdataとして保存し、安全検査済みの正規化file manifestを別に作る。absolute/parent traversal、link、special file、path衝突、展開quota超過を拒否し、host上でtarget package scriptを実行しない。
- target codeをhostで実行しない。Agent Sandboxと隔離検証環境（Verification Lab）へcontainer socketを渡さず、gVisor unavailable時にevidentiary runをplain Dockerへfallbackしない。
- Campaign setupは版付き・型付きSetup Planの許可操作だけをgVisor内で実行する。model提案を実行権限にせず、任意shell、任意PHP、未固定dependency downloadをSetup Planへ許可しない。
- model transportは公式配布・公式認証・固定version・安全性probeを満たすものだけを有効化し、consumer OAuthやsubscription keyを独自APIへ転用しない。
- provider組込みshell、web、plugin、hook、ambient MCPをworkerへ公開しない。source read/search、隔離scratch計算、typed Experimentはharness所有のrole別tool manifestからだけ提供する。
- FinderへWordPress runtime、HTTP/browser、network、任意shellを渡さない。静的に解けないmapping relationはSource Mapping内部の型付きRuntime Observationだけをfresh Lab cloneで観測し、Finding用Witnessと混同しない。
- provider credentialをmodel-visibleなfilesystem、environment、tool、prompt、transcriptへ置かない。tool subprocessから認証状態を隔離できないtransportはproduction不適格とする。
- egressはdefault-denyとし、外部serviceはlocal emulator、record/replay、`External Dependency Grant`の順で検討する。
- credential、token、private target、transcript、PoC、成立証拠（Witness）をGitへcommitしない。secret値をLedger、prompt、artifact metadataへ残さない。
- RCEの証明はdisposable Lab内のnonce付き`Execution Canary`だけを使う。reverse shell、persistence、host access、許可外egressを使わない。
- static ruleまたはmodel verdictだけで`Finding`へ昇格させない。固定Target Snapshot、独立Verification、成立証拠、因果対照実験（Causal Control）を要求する。
- 外部report、vendor連絡、issue、PR、公開artifactの作成・送信は明示的なuser authorizationなしに行わない。Human ConfirmationはExternal Action Authorizationではない。

## Git and review

- userの未関連変更を保持する。private campaign dataや生成物をstageしない。
- red-green中は`pnpm test <test-path>`で対象Seamだけを反復し、commit前はofflineかつ決定的な全体gateとして`pnpm check`を実行する。commandが未整備なら、その不足を隠さずhand-offへ記録する。
- reviewでは、oracle leakage、context ownership違反、Research事実のmutation、Verification bypass、raw transcript handoff、非決定的replay、model多数決によるsource-bound route消失、Runtime ObservationのWitness化、危険なtarget execution、grantなしegressをblockerとして扱う。
- safe pathは、sanitized immutable handoff、append-only record、fresh Verification、typed Experiment、explicit grant、human decisionの分離である。
