# 視覚中心のシステム理解資料

Status: research note, 2026-09-05

## 結論

巨大な一枚図や汎用フローチャートでは足りない。`全体 -> 処理 -> データ -> 具体例 -> 状態 -> 実行環境`の順に、同じシステムを六つのviewで見る資料が適する。

C4はContext、Container、Componentというzoomを使い、すべてのlevelを作る必要はなく、ContextとContainerで十分な場合が多いとしている。[C4 diagrams](https://c4model.com/diagrams) ISO/IEC/IEEE 42010も、stakeholderの異なるconcernをviewpointで分ける考え方を採る。[ISO/IEC/IEEE 42010:2022](https://www.iso.org/standard/74393.html) したがって以下は別々の図にし、一枚へ統合しない。

## 推奨する六つのview

| 順 | View | 答える質問 | wordpress-harnessで描くもの |
| --- | --- | --- | --- |
| 1 | System map | 誰が何を所有し、どこが境界か | `Target Intelligence -> Research -> Human OS`、人間、model provider、外部programme |
| 2 | Operating activity | 一件のTargetがどの分岐・並列処理を通るか | 選定、一括承認、dispatch、最大4 Finder、conditional Depth、single Validation、AI / Human reproduction、report approval |
| 3 | Artifact lineage | 各処理は何を読み、何をdurableに書き、誰へ渡すか | Selection ReceiptからApproved Submission Draftまでのversioned artifact、CAS / Ledger / private evidence |
| 4 | Worked sequence | 実際の一件では、時系列で何が起きるか | 公開可能な一Targetを選定してからFindingまたは根拠付きstopになるまでの具体例 |
| 5 | Lifecycle states | 今どの状態で、何が次の遷移を許すか | Target dispatch、Campaign、Validation disposition、AI Reproduction、Human Review Caseの小さなstate図 |
| 6 | Runtime / trust map | 何がどこで動き、何が隔離されるか | host、provider process、read-only source、AI lab、別fresh Human lab、private evidence store、programme form |

### 1. System map

既存の`architecture.svg`を入口として残す。C4のSystem Contextは技術詳細より人と外部systemを中心に全体像を示す図であり、最初に見るviewとして推奨される。[C4 System Context](https://c4model.com/diagrams/system-context)

この図には内部state、全artifact、例外分岐を足さない。各Contextを選ぶと後続viewへ移る「地図」にする。

### 2. Operating activity

三つのContextと人間をswimlaneにし、制御flow、並行性、判断gate、retry / pauseだけを描く。OMGはActivity diagramをaction間のdataとcontrolのflowを表すものと説明している。[OMG SysML diagram types](https://www.omg.org/sysml/sysmlv1/)

この図が、ユーザーの「ハーネスはどう処理するのか」に最も直接答える。データ構造や全statusは載せない。

### 3. Artifact lineage

boxを「処理」、document shapeを「versioned artifact」、cylinderを「durable store」に固定する。矢印は`reads / creates / hands off / references`をlabel付きで示す。

Architecture viewは関係するelementとrelationの集合であり、利用目的に応じたviewを選ぶべきだとSEIは説明する。[SEI Views and Beyond](https://www.sei.cmu.edu/library/views-and-beyond-collection/) 本ハーネスでは制御flowとartifact flowが異なるconcernなので分離する。

特に次を見えるようにする。

- source-only Research artifactとruntime evidenceの境界
- shareable packetとPrivate Evidence Bundleの境界
- CASへ保存してからLedger eventを記録する順序
- contextを越えるversioned handoffと、越えてはいけない内部storage
- exact payloadをResearchへ戻さず、opaque refだけ渡す関係

### 4. Worked sequence

公開可能な一Targetの一候補だけを使い、actor / module間のinteractionを上から下へ番号付きで描く。Sequence diagramはcollaborating partsのinteractionを表す。[OMG SysML diagram types](https://www.omg.org/sysml/sysmlv1/) C4 Dynamic diagramもruntime collaborationを示すが、複雑または反復する重要scenarioへ限定するよう勧める。[C4 Dynamic diagram](https://c4model.com/diagrams/dynamic)

抽象図を読むだけでなく、完成した一例を追えるようにする。Worked exampleを先に学ぶ方が、未習熟者が問題だけを解くよりschema獲得を助けた実験結果がある。[Sweller and Cooper, 1985](https://doi.org/10.1207/s1532690xci0201_3) これはsoftware理解への直接実験ではないため、ここでは「代表例を併置する」設計根拠として限定して使う。

例には各stepで次だけを添える。

- input artifact名
- decisionと根拠
- output artifactまたはtyped failure
- その時点で人間に見えるもの

### 5. Lifecycle states

状態機械はcontrol flow全体ではなく、長時間止まり得るentityに使う。OMGはState Machine diagramをeventに応じたstate transitionとactionの記述と位置付ける。[OMG SysML diagram types](https://www.omg.org/sysml/sysmlv1/)

一枚に混ぜず、`Campaign`、`Validation disposition`、`Human Review Case`の三panel程度にする。transition labelは`event [guard] / durable effect`とし、budget exhaustionやprovider failureが`no finding`へ変換されないことを見えるようにする。

### 6. Runtime / trust map

C4 Deployment diagramは、特定environmentでsystem / container instanceがどのinfrastructure node上に配置されるかを示す。[C4 Deployment diagram](https://c4model.com/diagrams/deployment) 本ハーネスでは通常のdeployment説明よりtrust boundaryの説明を優先する。

AI ReproductionとHuman Verificationを別nodeとして描き、fresh environment ID、許可されたinterface、egress、credential、cleanup、private evidenceの保存先を示す。source探索のread-only境界とruntime攻撃面を同じ矢印でつながない。

## 視覚記法

以下はPhysics of Notationsの、記号の一意性、識別性、意味の分かりやすさ、複雑さの管理、複数図の統合、textとの併用、記号数の抑制、audienceへの適合という原則を本repoへ適用したもの。[Moody, 2009](https://doi.org/10.1109/TSE.2009.67)

- 同じconceptは全図で同じshapeと色を使う。異なるconceptへ同じshapeを流用しない。
- 色だけに意味を持たせず、border、icon、labelも併用する。
- `Implemented`、`Accepted design`、`Planned`は塗りと線種を変え、legendへ明記する。
- arrowは一方向にし、`uses`ではなく運ぶartifactまたはactionをlabelにする。
- box内は名前、一行の責任、必要ならInterfaceだけにする。説明文は図の直下へ置く。
- 各図にtitle、scope、legend、更新日またはcommit、前後viewへのlinkを置く。
- 一画面で読めない場合はzoomではなくviewを分割する。

C4も、図単独で概ね理解できるtitle、legend、element type、短い責任、方向と意図が明確なlabel付きrelationshipを求める。[C4 notation guidance](https://c4model.com/diagrams/notation) また、絵と言葉の併用は言葉だけより理解を助け得る一方、余計な情報や同内容の重複は理解を妨げ得る。[Mayer and Moreno, 2002](https://www.psychology.mcmaster.ca/bennett/psy720/readings/m1/m1r3.pdf) したがって図を長文で言い直さず、図から読めない判断理由だけを短く補う。

## 避けるもの

- architecture、制御flow、artifact、state、deploymentを重ねた巨大な一枚図
- 全class、全file、全schema fieldを描く自動生成graph
- happy pathだけで、pause、stale、inconclusive、typed failureを消す図
- Researchの`ready-for-runtime`とHuman OSの`Finding`を同じ成功statusで描く図
- AI ReproductionとHuman Verificationを同一environmentとして描く図
- source-to-sinkを全体探索戦略として強調する図
- unlabeled arrow、色だけのstatus、legendなしの略語、box内の長文
- 同じ情報をMarkdown、SVG、draw.ioへ別々に手修正する運用

## 読ませる順序

1. System mapを30秒で眺める。
2. Operating activityで通常経路と人間gateを追う。
3. Artifact lineageで「何が残るか」を確認する。
4. Worked sequenceを一件、stepごとに追う。
5. 疑問が出たentityだけLifecycle statesを見る。
6. 実行・安全性を確認するときRuntime / trust mapを見る。
7. 実装へ入る場合だけCodebase GuideとContext別component zoomへ進む。

この順序は、C4のzoomによる段階的理解と、必要なviewだけをstakeholder concernから選ぶ考え方を組み合わせた提案である。[C4 introduction](https://c4model.com/introduction) [ISO/IEC/IEEE 42010:2022](https://www.iso.org/standard/74393.html)

## 配置と更新責任

人間向けの入口は、一つの`System Walkthrough`ページから六viewを順に開ける構成にする。初期版は少数の直接編集SVGとし、編集頻度が上がった場合だけmulti-page draw.ioを一つ導入してpageごとにexportする。diagram sourceを導入した後はsourceとexportを別々に編集しない。

| View | 更新trigger | 確認owner | 正本との照合 |
| --- | --- | --- | --- |
| System map | Context、外部actor、handoff変更 | architecture owner | `ARCHITECTURE.md`、`CONTEXT-MAP.md` |
| Operating activity | public behavior、gate、completion boundary変更 | owning Contextのmodule owner | Behavior Test、Issue acceptance |
| Artifact lineage | versioned contract、producer / consumer、durability変更 | artifact producer | schema、contract test |
| Worked sequence | 代表scenarioまたはfailure semantics変更 | end-to-end flow owner | named E2E test、公開可能なfixture |
| Lifecycle states | public status、guard、transition変更 | state owner | contract、replay test |
| Runtime / trust map | isolation、credential、egress、deployment変更 | Human OS / infrastructure owner | security invariant、adapter test |

Component zoomは常設の七つ目にしない。変更作業で必要なContextだけ作り、`CODEBASE-GUIDE.md`のPurpose、Interface、source、Behavior Testを描画元とする。C4もComponent diagramは価値がある場合だけ作り、長期保持するなら自動化を検討するよう勧める。[C4 Component diagram](https://c4model.com/diagrams/component)

図は仕様の複製ではなくviewである。public behavior、schema、security invariantは既存の正本へ残し、図から該当箇所へlinkする。
