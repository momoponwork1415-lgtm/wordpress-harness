# 対象選定の出力

具体的な提案、人間承認画面、Campaign Research Briefを作るときだけ読む。field名はリポジトリの現在の版付き契約へ合わせる。

## Selection Record

Target Intelligence内に保存する。数値は固定scoreへ合成せず、根拠と不確実性を説明する。

```yaml
selectionRecord:
  basis:
    observedAt: 2026-09-20T00:00:00Z
    candidatePoolRef: { id: pool-id, digest: sha256:... }
    guidanceRef: { id: guidance-id, digest: sha256:... }
    portfolioBoundary:
      activeInstallCount: { maximum: 1000000 }
  candidates:
    - identity: { slug: example-plugin, version: 1.2.3 }
      prospectiveFacts:
        activeInstallCount:
          value: 100000
          observedAt: 2026-09-20T00:00:00Z
          source: official-product-directory
          interpretation: bucketed-lower-bound
      impactCeiling: "..."
      attackerProximity: "..."
      securitySemanticBoundaries: []
      vulnerabilityHistoryAggregate:
        publishedRecordCount: 0
        observedProductLifetime: "..."
        density: "..."
        maximumCvss: null
        severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
        highOrCriticalCount: 0
        lastPublishedAt: null
        uncertainty: []
      updateActivity: "..."
      disclosureRoute: "..."
      ordinaryConfiguration: "..."
      externalSetup: []
      uncertainties: []
      decisionRationale: "..."
  exclusions: []
```

## Human Decision

候補ごとに次を示す。

- 正確な製品・版とimmutable sourceの状態
- 短い探索価値の根拠
- 通常構成と必要な外部設定
- 重要な不確実性
- 提案するsource closure
- approve / excludeと人間の理由

承認は正確な対象版とsourceに結び付く。使い捨てlab外の実行時攻撃や外部提出を許可しない。

## Approved Campaign handoff

Researchへ渡す選定由来の内容はこれだけにする。`wordpress-harness`では現在の`approved-target-campaign-request`契約を使い、別wrapperを作らない。

```yaml
kind: approved-target-campaign-request
schemaVersion: 1
approvedBatch: {}
candidateId: example-plugin-1.2.3
checkedAt: 2026-09-20T00:00:00Z
targetObservation: {}
targetIntake: {}
campaignId: campaign-example-plugin-1.2.3
campaignPolicy: {}
dependencySnapshots:
  - id: wordpress-core-7.1.1
    mountName: wordpress
    version: 7.1.1
    digest: sha256:...
    sourceTree: { digest: sha256:..., entries: 1000, bytes: 10000000 }
threatContext:
  kind: campaign-threat-context
  schemaVersion: 1
  id: threat-context-example-plugin-v1
  digest: sha256:...
  whyThisTarget: "The ordinary product surface can affect ..."
  ordinaryConfiguration: "..."
  attackerPositions: ["..."]
  securityObjectives: ["..."]
  trustBoundaries: ["..."]
  highValueTransitions: ["..."]
  dependencyRoles:
    - mountName: wordpress
      role: wordpress-core
      relevance: "最終的なframeworkのセキュリティ上の意味を定義する。"
  uncertainties: []
  explorationFreedom: off-model-findings-allowed
```

各Dependency Snapshotは`dependencyRoles`に対応する項目を一つだけ持ち、`wordpress-core` roleは一つだけにする。digestは現在の正確な契約から計算する。

## Dispatch前の漏洩確認

次を含むBriefは拒否する。

- 既知脆弱性、advisory、CVEの名前
- 履歴から得た影響ファイル、関数、行、patch、diff、commit、PoC
- 除外候補、比較順位、bounty見積り、費用計算
- SQLi、XSS、RCE、ATOなど事前指定した種類を探す命令
- 指定済みの読む順序、agent role、wave、仮説数、停止quota
- 非公開証拠、認証情報、外部identity、未公開の発見

公開機能、資産、攻撃者位置、通常構成、trust boundary、security propertyは記載できる。これらは探索の動機であり、答えではない。
