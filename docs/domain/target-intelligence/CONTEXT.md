# Target Intelligence

WordPress ecosystemの観測から、調査価値と取得可能性を評価し、oracle-freeなResearchへ渡せる対象を選ぶcontext。

## Language

**Intelligence Source**:
plugin directory、vulnerability intelligence、利用統計等、Target Observationの出所となる情報源。
_Avoid_: Feed、API

**Target Observation**:
取得時刻とIntelligence Sourceに結び付いた、plugin、version、利用状況、更新状況等についての不変な観測。
_Avoid_: Current fact、Target metadata

**Selection Fact**:
調査優先度または取得可否の判断に利用でき、prospective Researchへ渡しても既知脆弱性を示さない観測事実。利用規模、現行安定版、更新状況、取得可能性、外部公開面やintegrationの観測を含む。
_Avoid_: Signal、Score input

**Oracle Fact**:
既知の脆弱version、patch、CVE、advisory narrative等、prospective Researchへ渡すと発見能力の評価を汚染する情報。
_Avoid_: Selection Fact、Sensitive metadata

**Vulnerability History Aggregate**:
Oracle Factから対象固有の詳細を除いて件数または密度へ集約し、Target Intelligence内の選定にだけ使う履歴値。初期の主要な選定根拠ではなく、ResearchまたはTarget Intake Packetへ渡さない。
_Avoid_: Selection Fact、Vulnerability profile、Research hint

**Selection Policy**:
許可範囲、取得可能性、潜在impact、到達可能な攻撃面、利用規模、鮮度からTarget Candidateを選ぶversion固定した判断基準。programme適格性は外部提出価値を高めるが、技術的な調査価値を置き換えない。
_Avoid_: Ranking formula、Research priority

**Target Candidate**:
Selection Policyを満たす可能性があり、取得または人間reviewの対象になったpluginとversionの組。
_Avoid_: Target Snapshot、Finding candidate

**Plugin Identity**:
配布経路を名前空間に含めたpluginの安定identity。WordPress.org版は`wporg:<slug>`、premium版はoperatorがprovenanceと共に固定する`premium:<vendor>/<product>`を使う。
_Avoid_: Directory name、Plugin title、Bare slug

**Research-only Candidate**:
技術的な調査価値はあるが、現在のWordfence適格性スナップショットでは提出対象にならないTarget Candidate。programme対象外であることを、技術的なResearch対象外と同一視しない。
_Avoid_: Out-of-scope Target、False positive、Rejected Candidate

**Selection Receipt**:
Target Candidateを採用、保留、拒否した結論を、使用したSelection Fact、policy version、理由に結び付けた記録。Researchへ渡す場合は採用結論、policy version、oracle-freeな理由だけを公開する。
_Avoid_: Score、Approval

**Target Acquisition**:
選ばれたplugin sourceと配布metadataを、provenanceを失わずResearchへ受け渡せる状態にする行為。
_Avoid_: Download、Campaign setup

**Acquisition Original**:
archiveまたはdirectoryとして受け取ったsourceを、展開・正規化前の内容と入手経路へ結び付けて不変化した原本。
_Avoid_: Working copy、Extracted plugin、Target Snapshot

**Canonical File Manifest**:
取得原本から安全に読める通常fileを、単一プラグインルートからの正規化相対path、原文bytesのcontent identity、sizeへ結び付けた、source treeの主identityとなる安定順の不変表現。
_Avoid_: Directory listing、Archive index、Surface Map

**Single Plugin Root**:
一つのWordPress pluginとしてinstall対象になるsource treeの一意な起点。複数候補からの選択または外側bundle内のarchive展開を必要としない。
_Avoid_: Archive root、Bundle、Repository root

**Main Plugin File**:
単一プラグインルート内でWordPressが対象pluginとして認識・activateする、検証済みplugin headerを持つ相対path。一意に自動確定できない場合は明示を必要とする。
_Avoid_: Entrypoint、First PHP file、Filename identity

**Canonical Install Directory**:
通常配布時にplugin source treeを配置する`wp-content/plugins`直下のdirectory名。WordPress.org版はofficial slug、premium版はvendor provenanceまたは手動対象投入で明示した値に固定する。
_Avoid_: Plugin Identity、Temporary directory、Generated vendor/product slug

**Plugin Basename**:
正規インストールディレクトリと主プラグインファイルを結んだ、WordPressがactivationやplugin hookで扱う相対identity。
_Avoid_: Plugin Identity、Source tree identity、Host path

**Manual Target Intake**:
operatorが選んだ一つのpluginについて、source、version、入手経路、必要な構成と環境依存だけを提示する受入経路。既知脆弱性、疑わしいsymbol、期待class等の探索hintを含まない。
_Avoid_: Manual Campaign、Guided Research、Target recommendation

**Intake Disposition**:
対象をResearchへ渡せる`ready`、単一プラグインルートの特定または他の解消可能な前提が不足する`deferred`、scope・provenance・integrity等のpolicy違反がある`rejected`のいずれかへ、理由付きで固定した判断。
_Avoid_: Skip、Import error、Finding status

**Target Intake Packet**:
プラグイン識別子、主プラグインファイル、正規インストールディレクトリ、プラグイン配置識別子、照合済みversion、取得原本、正規化ファイル一覧、provenance、Selection Receiptを結び、Oracle Factを除外したResearch向けの不変handoff。
_Avoid_: Target Snapshot、Raw intelligence
