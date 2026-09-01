# Repository development rules

このファイルはrepository全体に適用する、長期的に安定した開発規則である。Codexのinstruction discoveryは[OpenAIのAGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)に従う。subtree固有の規則が実際に必要になるまでは、nested `AGENTS.md`を作らない。

## Mission and required reading

- North Starは、oracle-freeなprospective CampaignでRCEまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立VerificationとHuman Confirmationまで到達すること。
- 作業前に[CONTEXT-MAP.md](CONTEXT-MAP.md)、変更対象contextの`CONTEXT.md`、[architecture](docs/design/architecture.md)、関連ADRを読む。
- 設計を正当化する外部資料は[docs/REFERENCES.md](docs/REFERENCES.md)の3件だけとする。Codex文書やtool文書は開発手順の参考であり、第4の設計参照資料ではない。

## Architecture

- 初期systemはstrict TypeScriptのmodular monolithとし、`Target Intelligence -> Research -> Human OS`をprimary result flowとする。feedbackは公開contractを介し、context内部への逆向き依存を作らない。
- context間では不変かつversionedなcontractだけを渡す。別contextのstorage、内部module、provider objectを直接参照しない。
- `Target Intelligence`は選定と取得を所有し、oracleを除いた`Target Intake Packet`だけを`Research`へ渡す。
- `Research`は探索だけでなく、独立Verification、記録、優先順位付け、反復を所有する。Verificationを任意の後処理にしない。
- `Human OS`は人間のreviewと判断を所有する。Researchの事実を変更せず、digest固定した`Human Review Packet`への判断を追記する。
- CLI、将来のweb UI、remote controlはadapterであり、domain policyまたはlifecycleを所有しない。
- moduleは小さなinterfaceの背後に複雑さを隠す。二つ目の現実のadapterがない段階で汎用portやrepository abstractionを作らない。

## Change discipline

- 一回の変更は一つの観測可能なbehaviorまたは一つの明確な文書判断へ絞る。将来用のframeworkや未使用の設定を先回りして追加しない。
- hard-to-reverse、文脈なしでは意外、実在するtrade-offの3条件を満たす判断だけADRにする。既存ADRの歴史を書き換えず、新しいADRでsupersedeする。
- domain termが変わったら該当`CONTEXT.md`を同じ変更で更新する。`CONTEXT.md`へ実装詳細を置かない。
- 外部入力、event、artifact、prompt、Model Profileはversionとprovenanceを持ち、runtime schemaでdecodeする。
- clock、ID、randomness、provider response順をdomain判断へ暗黙に混ぜない。再現可能な入力とstable orderingを使う。

## Test-driven development

- 新しいbehaviorはred -> greenを一つのvertical sliceずつ進める。mechanical change、文書、test/build scaffoldを除き、先に失敗するtestを作る。
- 新しいtest surfaceを作る前に、public interfaceとtest対象のseamを設計文書へ明記し、userと合意する。testはそのseamからだけ観測する。
- private method、内部call count、内部module同士の呼出順、直接database queryでbehaviorを検証しない。
- expected valueはspecification、固定fixture、worked example等の独立した根拠から作り、implementationと同じ計算をtest内で再実装しない。
- mockはprovider CLI、clock、filesystem等のsystem seamだけに使う。所有する内部moduleはmockせず、可能ならreal local substituteを使う。
- refactorはgreenになったsliceのreview段階で行い、behavior変更と混ぜない。
- Ledger replay、crash境界、unknown event version、stable work ordering、Boundary Pairのpositive/negative/controlは回帰testを必須とする。

## TypeScript and PHP

- TypeScriptは`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を維持する。
- `any`、unchecked type assertion、non-null assertionをvalidationの代用にしない。versioned discriminated unionとexhaustive checkingを使う。
- PHPはpinned `nikic/PHP-Parser` helperに限定し、Campaign lifecycleまたは正本stateを所有させない。
- target PHP、target autoloader、target Composer script、WordPress bootstrapをsource analysisのためにhost上で実行しない。
- Pythonは短命な補助解析に限る。Goは測定されたprocess supervisionまたはCPU bottleneckが生じた時に再評価する。

## Security and evidence

- target codeをhostで実行しない。Agent SandboxとVerification Labへcontainer socketを渡さず、gVisor unavailable時にevidentiary runをplain Dockerへfallbackしない。
- egressはdefault-denyとし、外部serviceはlocal emulator、record/replay、`External Dependency Grant`の順で検討する。
- credential、token、private target、transcript、PoC、WitnessをGitへcommitしない。secret値をLedger、prompt、artifact metadataへ残さない。
- RCEの証明はdisposable Lab内のnonce付き`Execution Canary`だけを使う。reverse shell、persistence、host access、許可外egressを使わない。
- static ruleまたはmodel verdictだけで`Finding`へ昇格させない。固定Target Snapshot、独立Verification、Witness、Causal Controlを要求する。
- 外部report、vendor連絡、issue、PR、公開artifactの作成・送信は明示的なuser authorizationなしに行わない。Human ConfirmationはExternal Action Authorizationではない。

## Git and review

- userの未関連変更を保持する。private campaign dataや生成物をstageしない。
- implementation commit前に、変更scopeに応じたtest、typecheck、lintを実行する。commandが未整備なら、その不足を隠さずhand-offへ記録する。
- reviewでは、oracle leakage、context ownership違反、Research事実のmutation、Verification bypass、raw transcript handoff、非決定的replay、危険なtarget execution、grantなしegressをblockerとして扱う。
- safe pathは、sanitized immutable handoff、append-only record、fresh Verification、typed Experiment、explicit grant、human decisionの分離である。
