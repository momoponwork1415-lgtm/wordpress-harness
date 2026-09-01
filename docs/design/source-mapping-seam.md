# Source mapping seam

Status: accepted, 2026-09-01

## Owner and purpose

ResearchのSource Understanding内部にあるSource Mappingが所有する。固定Target Snapshotから、deterministic source analysisとmodel synthesisを混同せず、Exploration Controlが重複しないFocus Areaを作れる根拠状態付きSurface Map revisionへ変換する複雑性を一つのinterfaceの背後へ隠す。

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
    };
```

`MappingProfileRef`はPHP analysis profile、asset classification policy、Knowledge Capsule refs、Mapper用Model Profile、context ceiling、schema versionをdigest固定する。callerはparser、file list、prompt chunk、model session、host path、node merge順を渡さない。

## Interface invariants

- Surface MapはTarget Snapshot、Mapping Profile、predecessor、accepted Context Responseのdigestへ結び付き、同じ入力から同じcanonical refへ収束する。
- revisionはpredecessorを変更せず、新しいnode、relation、gap、coverage observationを追記またはsuperseding claimとして表す。過去claimを削除しない。
- Surface Mapは攻撃面を表すが、脆弱性の存在、severity、Finding昇格を判断しない。
- PHP Program Indexのschema-validなfactを`observed`として扱い、model outputで変更、削除、source range移動を行わない。
- `inferred`はsource anchorまたはKnowledge Capsule fact refを必須とし、根拠を持たないmodel relationを受理しない。
- `unknown`は候補、分からない理由、必要な次の証拠を持つ未解決状態であり、call edgeまたはreachability factとして扱わない。
- stable identityはarrival order、model wording、line number、host path、random IDへ依存しない。
- Target Snapshot外のWordPress Core、framework、external dependency knowledgeをTargetの`observed` source factとして保存しない。

## Canonical evidence states

```ts
type EvidenceState =
  | { kind: "observed"; sourceAnchors: readonly SourceAnchorRef[] }
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

source anchorはTarget Snapshot digest、relative path、file digest、byte rangeを持つ。line/columnは人間表示用でありidentityにしない。node identityはanchored subjectとkind、relation identityはcanonicalな端点、relation kind、claimをdigest化する。根拠状態またはpremiseが変わる場合は既存identityを上書きせず新claimとして結ぶ。

## Source and asset coverage

1. 正規化ファイル一覧の全entryをstable orderでinventory化する。
2. pinned PHP Program Indexからsymbol、WordPress registration、source、guard、storage、sink、diagnosticを`observed`として取り込む。
3. JavaScript、template、SQL、configuration、translation、bundled vendor、generated、minified、binary、unsupportedを分類する。
4. PHPまたは既存relationから根拠付きで参照されるassetをsource sliceとして接続する。
5. 処理しないassetも黙って除外せず、classification、size、digest、reasonをcoverage observationまたはgapへ残す。

PHP/WordPress factを地図の骨格にするが、Evidence Routeが非PHP assetを通ることを妨げない。bundled vendor codeは`bundled-vendor` provenanceを持ち、主対象からの到達可能性を確認する。minified、generated、binaryは既定で全文をmodel contextへ入れず、専門decoderまたは追加contextが必要というgapを作る。

## Mapper context

Mapperの初期contextはPHP Program Indexの関連fact、stable orderingのgraph近傍、根拠source slices、選択したKnowledge Capsule facts、明示したcoverage gapsだけから決定的にrenderする。全repositoryを一つのpromptへ投入せず、truncateした事実を成功扱いしない。

Mapperが追加sourceを必要とする場合は、anchor、理由、用途、期待する決定を持つContext Requestを出す。同一Targetのread-only source sliceでも要求と応答を記録し、physical host pathや暗黙のagent file historyに依存しない。追加sourceは次のSurface Map revisionへだけ入り、進行中revisionを変えない。

WordPress Coreまたはframework semanticsはversioned Knowledge Capsuleから選び、そこから導くrelationを`inferred: knowledge`とする。Target固有sourceから同じrelationを直接確認できた場合も、observed claimを別に追加して由来を失わない。

## Focus handoff

Source Mappingは脆弱性class、priority、worker割当を決めない。Surface Mapはentry、trust transition、state、sink、file/feature ownershipを示すstable surface anchorsを公開し、Exploration Controlが各anchorを一つのFocus Areaだけに所有させる。SQL injectionやStored XSS等のclassは複数surfaceを横断するExploration Laneであり、Focus Areaの所有keyではない。

## Failure semantics

- parseまたはname-resolution diagnosticはrecoverableなobserved factと同じrevisionにcoverage gapとして残す。
- Mapper failure、context ceiling、未対応assetは既存observed factを失わせず、reason付きgapを持つSurface Mapを返す。
- Target identity、file digest、predecessor、Knowledge CapsuleまたはPHP Program Indexの不一致、unknown schema、artifact corruptionは安全側にbuildを拒否し、partial revisionを公開しない。
- source anchorが一件も成立しなくてもmanifest inventoryとgapを持つMapを返せるが、Coverage Closureまたは「解析成功」を意味しない。

## Test surface

behavior testは`build(input)`が返すSurfaceMapRefと、そのrefからResearch Record経由で読めるimmutable viewだけを観測する。PHP parser visitor、file traversal順、prompt chunk数、model call count、内部merge functionを直接assertしない。production PHP helperとdeterministic Mapper test adapterはSource Mapping内部seamに置き、context-publicなparserまたはmapper portにしない。

## Acceptance scenarios

1. 同じTarget SnapshotとMapping Profileは同じSurface Map ref、node identity、relation identityを返す。
2. PHP Program Indexのobserved hookをmodelが異なるhook名として出力しても、元factは変更されず矛盾した出力は受理されない。
3. 組立てhookまたはdynamic callを一意に解決できない場合、候補と必要証拠を持つ未解決（unknown）relationになる。
4. PHPから参照されるJavaScript templateはfile digestとsource anchorを持ってMapへ接続される。
5. 到達可能なbundled vendor関数はprovenance付きで接続され、vendor directoryという理由だけで除外されない。
6. minified assetをceilingのため読まない場合、asset metadataとreason付きgapが残る。
7. Knowledge Capsule由来のWordPress relationはinferredとして記録され、Targetのobserved factにならない。
8. Mapperの追加file要求はContext RequestとContext Responseを経た次revisionへ入り、元revisionは同じdigestを保つ。
9. parse errorのある一fileが存在しても、他fileのobserved factとdiagnostic gapを持つMapを返す。
10. Exploration Controlはsurface anchorを重複所有しないFocus Areaへ分割でき、vulnerability classを所有keyにしない。
