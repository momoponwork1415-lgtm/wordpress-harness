# Source mapping seam

Status: accepted; first static slice implemented, 2026-09-02

## Owner and purpose

ResearchのSource Understanding内部にあるSource Mappingが所有する。固定Target Snapshotから、deterministic source analysisとmodel synthesisを混同せず、Exploration Controlが重複しないFocus Areaを作れる根拠状態付きSurface Map revisionへ変換する複雑性を一つのinterfaceの背後へ隠す。

全体像は[Surface Map visual guide](../visuals/surface-map.html)で、Interfaceの深さ、根拠状態、決定論的解析とAI Mapperの責任分担を図解する。

## Interface

```ts
interface SourceMapping {
  build(input: SurfaceMappingInput): Promise<SurfaceMapRef>;
}

type SurfaceMappingInput =
  | { kind: "initial"; target: TargetSnapshotRef; profile: MappingProfileRef }
  | {
      kind: "revision";
      predecessor: SurfaceMapRef;
      acceptedContext: readonly ContextResponseRef[];
      profile: MappingProfileRef;
    }
  | {
      kind: "runtime-revision";
      predecessor: SurfaceMapRef;
      baseline: LabBaselineRef;
      requests: readonly MappingEvidenceRequestRef[];
      profile: MappingProfileRef;
    };
```

`MappingProfileRef`はPHP analysis profile、asset classification policy、Knowledge Capsule refs、Mapper用Model Profile、context ceiling、Runtime Observation policyとbudget、schema versionをdigest固定する。callerはparser、file list、prompt chunk、model session、host path、node merge順、Lab handleを渡さない。

## Implemented static slice

最初の実装は`initial`と、空の`acceptedContext`を持つsource-only `revision`を提供する。全manifest entryをinventory化し、PHP Program IndexのsymbolとWordPress factをsource anchor付き`observed` nodeへ変換する。一意なliteral callback名の対応は、runtime dispatchではなく構文上の名前対応なので決定論的な`inferred` relationにする。literal名が解決不能または曖昧なcallbackと、callback式が非literalなregistrationは、必要証拠を持つ`unknown` relationとして残す。非PHP asset、PHP index欠落、parse diagnosticはgapになる。

Target IntakeとTarget Workspaceが未実装の間は、`openSourceMapping`の内部bootstrap構成で一つの固定Target Snapshot、manifest ref、PHP Program Index ref、private CAS directoryを束ねる。`build`へhost pathまたはfile listは渡さない。この構成はTarget Workspace接続時に置き換え、`build`のInterfaceとbehavior testを維持する。

現時点では非空のContext Response、Mapper model、Knowledge由来inference、非PHP asset relation、`runtime-revision`を処理しない。未対応assetを解析済みにせずgapとして公開する。これらは実戦のmapping gapまたは後続Issueから追加する。

最終的なSurface Map全体を決定論的解析だけで構築する方針ではない。決定論的sliceはTarget identity、inventory、構文上のfact、source anchor、evidence state、stable orderingという骨格を固定する。Mapper modelはその上へ、feature境界、cross-file relation、dynamic dispatch候補、stateを跨ぐroute、追加Context Requestを`inferred`または`unknown`として補完する。modelは`observed`を訂正・削除せず、重要なrelationはsemantic analysisまたはpolicy適合Runtime Observationから別の根拠を追加する。

### 決定的な構築手順（Deterministic construction）

1. manifest、PHP Program Index、predecessorをdigest指定でprivate CASから読み、schema、Target identity、analysis profile、summaryを照合する。
2. manifest全entryをpathのcode-unit順へ固定し、PHP index済みか理由付きgapかを記録する。
3. PHP symbolとWordPress factから、Target digest、relative path、file digest、byte offset、subjectをcanonical化してnode IDを作る。表示用line番号、host path、入力配列の到着順はIDへ含めない。
4. literal callback名が一つのsymbol名へ対応する時だけ、両nodeをpremiseに持つ決定論的な`inferred` relationを作る。ゼロ件または複数件なら候補と必要証拠を持つ`unknown` relationにする。callbackが非literalならregistrationを黙って落とさず、`callback-not-literal`と必要なexpression evidenceを持つ`unknown` relationにする。
5. 非PHP asset、PHP index欠落、parse diagnosticをgapへ変換し、node、relation、gapをstable ID順へ並べる。
6. source-only revisionではpredecessorのnode、relation、gapを保持し、新しいclaimだけを追加する。旧artifactは書き換えない。
7. 完成viewをcanonical JSONとしてCASへ保存し、そのdigestをSurface Map refとして返す。

Surface Map refはmanifestとPHP Program Indexの正確なartifact digestへ結び付くため、入力artifactが異なればrefも異なる。一方、同じsource anchorとclaimから作るnode/relation IDは入力配列の順序が変わっても同じになる。この分離によりprovenanceの違いを失わず、同じ研究上のclaimをrevision間で追跡できる。

この方式はMapの内容が正しいと仮定するものではない。parser事実、推論、未解決relation、未解析assetを区別し、誤りや不足が後から観測・訂正できることを保証する。

根拠と適用限界は[White-box Surface Mapping security reference](../research/white-box-surface-mapping-security-reference.md)に記録する。OSWE固有の手順には固定せず、OWASP、NIST、OASIS、公式static-analysis documentation等の一次資料が収束する実務を採用する。

### 実プラグインによる特性確認（Real-target characterization）

合成fixtureのBehavior Testに加え、Git外のprivate Campaign workspaceでBrizy 2.8.11と2.8.12を同じprofileから解析する。Source Mappingへadvisory、CVE、既知symbol、payload、patch説明は渡さない。まずinventory、observed node、inferred/unknown relation、coverage gapを出力し、その後に公開済みoracleと照合して「既知routeを発見したか」だけでなく「どの解析不足がrouteを隠したか」を記録する。

このrunは合成fixtureを置き換えない。合成fixtureは決定性とfailure semanticsを高速に保護し、実Targetはnamespace、class callback、conditional registration、bundled dependency、非PHP asset等の想定漏れを発見する。positiveだけに合わせずpatched negativeも同じ手順で処理し、脆弱性名やversion固有symbolを汎用実装へ埋め込まない。

2026-09-02の最初のrunでは、非literal callbackを持つregistrationがrelationなしで消える欠陥を検出した。修正後は405 registrationすべてがrelationを持ち、9件が`inferred: deterministic`、396件が理由付き`unknown`になった。既知Stored XSS routeはまだ接続できず、これが後続AI Mapperとflow relationの具体的な入力になる。取得hash、集計、oracle照合は[security reference](../research/white-box-surface-mapping-security-reference.md#real-target-characterization)に残す。

同日の5 plugin family比較では全PHPをparse diagnostic 0件で処理できた一方、callback解決率が大きく異なり、superglobal、直接request候補PHP、file/code/SQL operationが骨格に不足していることが分かった。局所的で再現可能なsource factだけを実測に基づいて追加し、全call graphやtaint engineを先回りで自作しない。cross-file/cross-request relationとsecurity invariantはMapper modelの補完対象とする。

## Interface invariants

- Surface MapはTarget Snapshot、Mapping Profile、predecessor、accepted Context Response、実行したRuntime Observationのdigestへ結び付き、同じ入力から同じcanonical refへ収束する。`runtime-revision`だけがLab Baselineを入力に持つ。
- revisionはpredecessorを変更せず、新しいnode、relation、gap、coverage observationを追記またはsuperseding claimとして表す。過去claimを削除しない。
- Surface Mapは攻撃面を表すが、脆弱性の存在、severity、Finding昇格を判断しない。
- PHP Program Indexのschema-validなfactとpolicy適合したRuntime Observationを`observed`として扱い、model outputで変更、削除、evidence anchor移動を行わない。
- `inferred`はsource anchorまたはKnowledge Capsule fact refを必須とし、根拠を持たないmodel relationを受理しない。
- `unknown`は候補、分からない理由、必要な次の証拠を持つ未解決状態であり、call edgeまたはreachability factとして扱わない。
- stable identityはarrival order、model wording、line number、host path、random IDへ依存しない。
- Target Snapshot外のWordPress Core、framework、external dependency knowledgeをTargetの`observed` source factとして保存しない。

現行sliceはpredecessor claimを監査用に保持できるが、`superseded`、`contradicted`、`retracted`状態をまだ実装していない。したがって訂正を含むrevisionには未対応であり、保持されたclaimを常に最新のactive truthと解釈しない。訂正を受け入れる前に明示的なsupersession表現を追加する。

## Canonical evidence states

```ts
type EvidenceState =
  | {
      kind: "observed";
      evidence: readonly (SourceAnchorRef | RuntimeObservationRecordRef)[];
    }
  | {
      kind: "inferred";
      premises: readonly EvidenceRef[];
      derivation: "deterministic" | "knowledge" | "model";
    }
  | {
      kind: "unknown";
      candidates: readonly SurfaceAnchorRef[];
      reason: UnresolvedReason;
      requiredEvidence: readonly EvidenceNeed[];
    };
```

source anchorはTarget Snapshot digest、relative path、file digest、byte rangeを持つ。Runtime Observation RecordはLab Baseline、Plan、request、観測対象、結果、上限、cleanup receiptをdigest固定する。line/columnは人間表示用でありidentityにしない。node identityはanchored subjectとkind、relation identityはcanonicalな端点、relation kind、claimをdigest化する。根拠状態またはpremiseが変わる場合は既存identityを上書きせず新claimとして結ぶ。

## Source and asset coverage

1. 正規化ファイル一覧の全entryをstable orderでinventory化する。
2. pinned PHP Program Indexからsymbol、WordPress registration、source、guard、storage、sink、diagnosticを`observed`として取り込む。
3. JavaScript、template、SQL、configuration、translation、bundled vendor、generated、minified、binary、unsupportedを分類する。
4. PHPまたは既存relationから根拠付きで参照されるassetをsource sliceとして接続する。
5. 処理しないassetも黙って除外せず、classification、size、digest、reasonをcoverage observationまたはgapへ残す。

PHP/WordPress factを地図の骨格にするが、Evidence Routeが非PHP assetを通ることを妨げない。bundled vendor codeは`bundled-vendor` provenanceを持ち、主対象からの到達可能性を確認する。minified、generated、binaryは既定で全文をmodel contextへ入れず、専門decoderまたは追加contextが必要というgapを作る。

## Mapper context

Mapperの初期contextはPHP Program Indexの関連fact、stable orderingのgraph近傍、根拠source slices、選択したKnowledge Capsule facts、明示したcoverage gapsだけから決定的にrenderする。全repositoryを一つのpromptへ投入せず、truncateした事実を成功扱いしない。

graph近傍はOpenAntのPHP parserと同様にcaller/calleeの双方向をdepth-boundedなAnalysis Unitへ束ねられる。ただしUnitはmodelへ渡すcontext containerであって、完全なcall graphまたは到達可能性の証明ではない。構文上のentryが一件も取れない時やedge欠落が疑われる時は対象を除外せず、coverage gapを残してfail openする。Mapperが追加entry候補を示しても既存のobserved entryをdemoteせず、source anchor付き`inferred`候補として次revisionへ追加する。実装比較と採否は[Harness source-mapping implementation patterns](../research/harness-source-mapping-patterns.md)に記録する。

Mapperが追加sourceを必要とする場合は、anchor、理由、用途、期待する決定を持つContext Requestを出す。同一Targetのread-only source sliceでも要求と応答を記録し、physical host pathや暗黙のagent file historyに依存しない。追加sourceは次のSurface Map revisionへだけ入り、進行中revisionを変えない。

WordPress Coreまたはframework semanticsはversioned Knowledge Capsuleから選び、そこから導くrelationを`inferred: knowledge`とする。Target固有sourceから同じrelationを直接確認できた場合も、observed claimを別に追加して由来を失わない。

## Runtime Observation

static sourceとKnowledge Capsuleだけではdynamic hook、callback、registration、dispatch、state transitionを一意に確定できず、Explorationが情報利得の高いMapping Evidence Requestを返した場合だけRuntime Observationを検討する。Source Mappingはrequestを、許可操作、固定request、観測対象、客観的成功条件、resource ceiling、cleanupを持つ版付きPlanへ変換する。

Planはsealed Lab Baselineのfresh cloneで実行する。Source Mapping内部の`RuntimeObservationPort`だけがdeterministic test adapterまたはgVisor production adapterへ到達し、context-public interface、Mapper、Finder、Campaign ControlへLab、HTTP、browser、shellを公開しない。任意payload、権限境界の突破、外部egress、Target変更、unbounded request生成を許可しない。

Runtime ObservationはMapのregistration、dispatch、state relationを支持または反証できるが、security propertyの破壊を試さず、Witness、Causal Control、Finding evidenceとして再利用しない。Observation failureはrelationの不成立ではなく、reason付き`unknown`またはmapping gapとして次revisionへ残す。詳細は[ADR 0108](../adr/0108-observe-dynamic-mapping-with-typed-lab-plans.md)に記録する。

## Focus handoff

Source Mappingは脆弱性class、priority、worker割当を決めない。Surface Mapはentry、trust transition、state、sink、file/feature ownershipを示すstable surface anchorsを公開し、Exploration Controlが各anchorを一つのFocus Areaだけに所有させる。SQL injectionやStored XSS等のclassは複数surfaceを横断するExploration Laneであり、Focus Areaの所有keyではない。

## Failure semantics

- parseまたはname-resolution diagnosticはrecoverableなobserved factと同じrevisionにcoverage gapとして残す。
- Mapper failure、context ceiling、未対応assetは既存observed factを失わせず、reason付きgapを持つSurface Mapを返す。
- Runtime Observationのpolicy拒否、timeout、Lab failureは対象relationをfalseにせず、必要証拠とfailure reasonを持つ`unknown`として残す。
- Target identity、file digest、predecessor、Knowledge CapsuleまたはPHP Program Indexの不一致、unknown schema、artifact corruptionは安全側にbuildを拒否し、partial revisionを公開しない。
- source anchorが一件も成立しなくてもmanifest inventoryとgapを持つMapを返せるが、Coverage Closureまたは「解析成功」を意味しない。

## Test surface

behavior testは`build(input)`が返すSurfaceMapRefと、そのrefからResearch Record経由で読めるimmutable viewだけを観測する。PHP parser visitor、file traversal順、prompt chunk数、model call count、内部merge function、gVisor commandを直接assertしない。production PHP helper、deterministic Mapper test adapter、Runtime Observationのdeterministic/production adapterはSource Mapping内部seamに置き、context-publicなparser、mapper、Lab portにしない。

## Acceptance scenarios

1. 同じTarget SnapshotとMapping Profileは同じSurface Map ref、node identity、relation identityを返す。
2. PHP Program Indexのobserved hookをmodelが異なるhook名として出力しても、元factは変更されず矛盾した出力は受理されない。
3. 組立てhook、非literal callbackまたはdynamic callを一意に解決できない場合、候補と必要証拠を持つ未解決（unknown）relationになる。
4. PHPから参照されるJavaScript templateはfile digestとsource anchorを持ってMapへ接続される。
5. 到達可能なbundled vendor関数はprovenance付きで接続され、vendor directoryという理由だけで除外されない。
6. minified assetをceilingのため読まない場合、asset metadataとreason付きgapが残る。
7. Knowledge Capsule由来のWordPress relationはinferredとして記録され、Targetのobserved factにならない。
8. Mapperの追加file要求はContext RequestとContext Responseを経た次revisionへ入り、元revisionは同じdigestを保つ。
9. parse errorのある一fileが存在しても、他fileのobserved factとdiagnostic gapを持つMapを返す。
10. Exploration Controlはsurface anchorを重複所有しないFocus Areaへ分割でき、vulnerability classを所有keyにしない。
11. dynamic callbackのRuntime Observationはfresh Lab cloneと固定Planを持ち、次revisionのobserved runtime evidenceになる。
12. 同じObservationをWitnessとしてFindingへ渡そうとすると拒否される。
13. Observationがtimeoutしてもcallback不存在とは判定されず、reason付きunknownが残る。
