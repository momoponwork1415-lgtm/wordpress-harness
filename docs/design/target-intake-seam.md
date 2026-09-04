# Target intake seam

Status: accepted, 2026-09-01

## Owner and purpose

Target IntelligenceのAcquisition moduleが所有する。untrustedなarchiveまたはdirectoryから、安全でoracle-freeなTarget Intake Packetを作る複雑性を一つのinterfaceの背後へ隠す。Research、CLI、将来のWordfence adapterへarchive内部path、staging directory、hash順、CAS transactionを知らせない。

## Interface

```ts
interface TargetIntake {
  intake(request: ManualTargetIntakeRequest): Promise<IntakeDisposition>;
}

type IntakeDisposition =
  | {
      status: "ready";
      receipt: IntakeReceipt;
      receiptRef: IntakeReceiptRef;
      packet: TargetIntakePacket;
      packetRef: TargetIntakePacketRef;
    }
  | {
      status: "deferred" | "rejected";
      receipt: IntakeReceipt;
      receiptRef: IntakeReceiptRef;
      reasons: readonly IntakeReason[];
    };
```

値とdigest固定refを同時に返し、callerがAcquisition内部storageを直接読む必要をなくす。context間handoffまたはdurableな関連付けにはrefを使い、その場の表示・validationには同時に返るimmutable valueを使う。

`ManualTargetIntakeRequest`は、一つのlocal source locator、`wporg:<slug>`または`premium:<vendor>/<product>`の宣言plugin identity、要求version、任意のmain plugin file relative path、premium版で必須となるcanonical install directory、取得provenance、Canonical Configurationに必要な情報、明示的な環境依存、Intake Policy refだけを受け取る。WordPress.org版のcanonical install directoryはrequest値を採用せずofficial slugから確定する。local pathはinput transportでありdurable identityに含めない。自由文の選定理由、既知脆弱性、疑わしいfile・symbol・parameter、期待class・routeをfieldとして持たない。unknown fieldは無視せずdecode時に拒否する。

Acquisition moduleは内部で取得原本のcapture、safe staging、正規化file manifest、content hashing、private CAS write、provenance検査、reason classification、packet生成を完了させる。callerへこれらの途中stepをinterfaceとして公開しない。

## Interface invariants

- 一回のrequestは一つの主対象pluginだけを表す。
- 入力は一つのinstall可能なplugin rootを一意に特定できる。選択が必要なbundleはdeferredとなる。
- plugin identityは配布経路で名前空間化し、directory basenameまたは表示名をidentityとして推測しない。
- main plugin fileは明示pathを検証するか、有効なplugin header候補が一つの場合だけ自動確定する。
- versionはmain header、request、利用可能な配布metadataで照合し、不足をdeferred、矛盾をrejectedとする。
- canonical install directoryとmain plugin fileからPlugin Basenameを作り、host pathと分離する。
- readyを返す前に取得原本、正規化ファイル一覧、receipt、packetをdurableにし、全refをdigest固定する。
- deferredまたはrejectedはpacketを返さず、入力digest、policy version、安定したreason codeを持つreceiptを残す。
- expectedなpolicy outcomeはexceptionにせずIntake Dispositionで返す。I/O failure、CAS unavailable、process crash等、判定をdurableにできないsystem failureだけをerrorにする。
- 同じrequest digestとpolicy versionの再試行は同じdurable dispositionを返す。途中artifactをreadyとして公開しない。
- sourceのPHP、Composer、npm、install hookその他のtarget-controlled codeをhost上で実行しない。
- runtime上のinstall・activate成功はinterfaceの保証に含めない。

## Safe source rules

受理するsource treeは通常fileとdirectoryだけである。absolute path、parent traversal、NUL path、symlink、hardlink、device、FIFO、socket、重複path、caseまたはUnicode正規化後の衝突を拒否する。versioned Intake Policyがentry数、単体file size、総展開size、path length、nesting depthの上限を持つ。directory inputはlinkを追わずprivate stagingへcaptureし、取得後のbytesからmanifestを作る。

正規化ファイル一覧は単一プラグインルートからのrelative pathの安定順で、各通常fileの原文bytesに対するcontent digestとsizeを持つ。file内容、改行、encoding、whitespaceを変換しない。manifest digestをsource treeの主identityとし、取得原本のdigestはprovenanceとして別に持つ。archive timestamp、owner、compression method・level、input local pathをtree identityへ混ぜない。

入力が複数のplugin rootまたはinstall対象を選ぶためのnested archiveを含む外側bundleなら、`deferred: single-plugin-root-required`を返す。単一プラグインルートの中にdataとして存在するarchive fileは再展開せず、そのbytesを通常fileとしてmanifestへ含める。

## Plugin identity and version rules

WordPress.org版はofficial slugを`wporg:<slug>`へ正規化し、premium版はoperatorが正規入手provenanceと共に`premium:<vendor>/<product>`を明示する。plugin directory、archive basename、`Plugin Name`表示文字列だけからidentityを生成しない。

main plugin file pathが指定された場合は、単一プラグインルート内の通常fileで有効なplugin headerを持つことを検査する。未指定の場合だけstatic header scanを行い、候補が一つなら確定する。ゼロは`deferred: main-plugin-file-missing`、複数は`deferred: main-plugin-file-ambiguous`とする。

main plugin fileの`Version` header、request version、取得経路が提供するauthoritative distribution versionをopaque labelとして照合する。必要なevidenceがない場合は`deferred: version-evidence-missing`、値が矛盾する場合は`rejected: version-mismatch`とする。SemVer coercionやdirectory/archive filenameからの推測は行わない。

ready packetはplugin identity、main plugin file relative path、照合済みversion、各version evidence refをdigest固定する。

## Canonical install location

WordPress.org版のcanonical install directoryはofficial slugであり、source archiveまたはrequestの異なるdirectory名を優先しない。premium版はvendor配布metadataまたはmanual requestで明示し、Plugin Identity、archive basename、Plugin Nameから自動生成しない。required valueがない場合は`deferred: canonical-install-directory-missing`、official provenanceと矛盾する場合は`rejected: canonical-install-directory-mismatch`とする。

directoryは`wp-content/plugins`直下のlogical child nameとして検証し、host absolute pathをpacketへ保存しない。canonical install directoryとmain plugin file relative pathを`<directory>/<main-file>`のPlugin Basenameとしてpacketへ固定する。

Campaign setupはcanonical Plugin Basenameどおりにmaterialize・activateする。alternate install directoryはTarget Snapshotを変更せず、Configuration Variantがalternate directory、effective Plugin Basename、根拠を固定する。Witness、Causal Control、Findingは実際に使ったVariant digestを参照する。

## Runtime setup seam

readyなpacketだけがResearchのCampaign preparationへ進める。Campaign setupはTarget Snapshot、Runtime Profile、Canonical ConfigurationからgVisor内でLab Baselineを作り、install・activateと最小smokeを行う。失敗はセットアップ阻害の未完了Campaign outcomeであり、過去のready receiptを変更しない。

AcquisitionはVerification Lab interfaceを呼ばず、Researchはarchiveを再展開または受入policyを再判定しない。Target-controlled codeを実行する最初の場所はCampaign setupが所有するgVisor内である。

## Acceptance scenarios

1. 同じsource bytesとpolicyを別host pathから投入しても同じcontent identityとdispositionになる。
2. traversal entryまたはsymlinkを一つ含むsourceはrejectedとなり、Target Intake Packetを作らない。
3. quota超過はreason code付きrejectedとなり、部分展開物をResearchへ公開しない。
4. package内にComposerまたはnpm script定義があってもdataとして保存するだけで実行しない。
5. ready後にgVisor内のinstallが失敗してもIntake Dispositionは変わらず、Campaignだけがセットアップ阻害で停止する。
6. processがCAS write途中で停止しても再試行はpartial packetを返さず、同じrequestを安全に収束させる。
7. 同じfile treeを異なるcompressionまたはarchive timestampでpackした二つの取得原本は、原本digestが異なっても同じsource tree identityになる。
8. 複数pluginを含む外側bundleはdeferredになるが、単一plugin root内のarchive data fileはそのままmanifestへ含まれる。
9. WordPress.org slug、package、main header versionが一致したsourceは名前空間付きidentityとversion evidenceを持つready packetになる。
10. main plugin header候補が複数あるsourceはfile順で選ばずdeferredになり、明示path付きの新requestでだけ解消できる。
11. request versionとmain header versionが異なるsourceはrejectedになり、directory名またはarchive名で補正しない。
12. WordPress.org版は入力archiveのwrapper名に関係なくofficial slugをcanonical install directoryに使う。
13. premium版でcanonical install directoryの根拠がない場合はdeferredとなり、vendor/product identityから生成しない。
14. alternate directoryでのみ成立するExperimentはcanonical Target Snapshotを変更せず、Configuration Variantへeffective Plugin Basenameを固定する。

## Test surface

testは`intake(request)`から返るIntake Dispositionと、そのrefから公開されるimmutable packetまたはreceiptだけを観測する。real temporary filesystemとlocal private CASを使い、archive parser、path checker、header scanner、manifest builderの内部call順またはprivate resultを直接testしない。productionで二つ目のarchive implementationが必要になるまで、parser portをexternal seamへ追加しない。
