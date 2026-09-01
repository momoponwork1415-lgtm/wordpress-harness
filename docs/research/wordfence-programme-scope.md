# Wordfence programme scope and false-positive controls

Status: implementation research, captured 2026-09-01

## Purpose

Wordfence Bug Bounty Programをこのharnessの主要なTarget選定・提出先として扱い、同programが公開する共通誤検出基準をVerificationの反証条件へ取り込むための一次資料メモ。これは[3件の設計参照資料](../REFERENCES.md)を追加・置換するものではない。programmeの現行規則を永久不変ともみなさない。

## Current official facts

2026-09-01の[Wordfence Bug Bounty Program](https://www.wordfence.com/threat-intel/bug-bounty-program/)では、認証なしまたはSubscriber/Customer程度の低権限から攻撃できる場合、次を主な高脅威classとしている。

- 任意PHP file upload/read/deletion
- 任意option update
- remote code execution
- adminへのauthentication bypassまたはprivilege escalation

現行のactive installation thresholdは、上記高脅威classが25、Stored XSSとSQL injectionが500。その他の対象classはresearcher tierで変わり、`1337 Researcher`は500である。25〜999の高脅威class、500〜999のStored XSS/SQL injectionはWordPress.org掲載が必要で、premium productは1,000未満で対象外とされている。`1337 Researcher`の対象内審査待ち上限は50件である。

WordPress Core、別のbug bountyを持つ特定vendor製品、公開または販売停止中のproduct、plugin/themeが使うvendor側の非local web serviceなどはprogramme対象外である。これらは脆弱性の技術的不成立を意味しない。

## Project target decision

このprojectの対象assetはWordPress pluginだけとする。Wordfenceのprogramme scopeにthemeが含まれていても、themeの選定、解析、検証は実装しない。WordPress Coreも現在のharnessでは非対応・計画外とする。対象変更の可能性だけを理由に、themeまたはCore用の型、adapter、検証分岐を作らない。

将来の発展候補はCore対応ではなく、WordPress外のホワイトボックス・バグバウンティ用別productとする。この方向性も現行のWordfence適格性スナップショットまたはplugin用Target contractを汎用化する根拠にはしない。

Pluginの配布形態はWordPress.org配布とpremiumの両方を許可する。premium pluginはoperatorが利用権限を持つsourceをlocalから手動importし、harness自体はvendor accountへのloginまたはdownloadを自動化しない。Wordfence適格性はactive installations、salesまたはWordfence側の判定に依存し得るため、sourceが取得できたこととprogramme対象内であることは別に記録する。

## False-positive evidence

同公式ページは、理論上のみのissue、実害のない意図された機能、到達不能な脆弱dependency、self-XSS、非安全な環境設定だけに依存するissueなどを「Common False Positive Reports」または対象外の例として挙げている。また、実在しないcodeを報告するAI hallucinationと、その他のfalse positiveを区別し、繰り返しはthrottleまたはbanの対象になり得るとしている。

このリストを文字列blocklistとして使わない。Verificationで次の確認可能な反証条件へ正規化する。

1. 報告対象のsymbolとrouteが固定Target Snapshot内に実在するか。
2. Permitted Attackerが現実的な設定でentry pointへ到達できるか。
3. nonce、capability check、sanitization、escaping等の既存防御がrouteを遮断しないか。
4. attacker-controlled valueが主張したsinkまで因果的に届くか。
5. 成立証拠でsecurity propertyの破壊を観測でき、因果対照実験で主張原因を除くと消えるか。
6. 意図された機能、高権限、過度な設定、古いbrowser、外部dependencyなど、必要な前提を全て記録しても実害が成立するか。

## Design decision

判定は次の三つを混同しない。

| Technical result | Programme result | Stored result |
| --- | --- | --- |
| 不成立 | 判定不要 | `Disproved` / `Invalid`。誤検出として理由と証拠を保持 |
| 成立 | 対象外 | `Finding` + `Programme Disposition: ineligible` |
| 成立 | 対象内 | `Finding` + `Programme Disposition: eligible` |

このprojectのNorth StarはWordfence適格性ではなく、Argus/darooを参考にしたFrontier Discovery Capabilityである。Wordfence規則は主に次へ使う。

- Target Intelligenceで、提出可能性とimpactの高いTargetを優先する。
- Verificationで、公式な共通誤検出例をfalsifierに変換して使う。
- Human OSで、Finding確定後に現行スナップショットと照合する。

## Required snapshot fields

- `capturedAt`
- `sourceUrl`
- `sourceDigest`
- `researcherTier` — 初期値は`1337`
- `assetRules`
- `attackerRoles`
- `vulnerabilityClassRules`
- `activeInstallationThresholds`
- `repositoryListingRules`
- `excludedAssets`
- `pendingSubmissionLimit`

Wordfence Intelligenceの[Production Vulnerability Data Feed](https://www.wordfence.com/help/wordfence-intelligence/v3-accessing-and-consuming-the-vulnerability-data-feed/)は既知脆弱性の詳細を含む。Target Intelligenceは取得できるが、既知vulnerability identity、affected version、advisoryはOracle Factに分類し、prospective CampaignのTarget Intake Packetやworker promptへ含めない。

既知脆弱性との重複照合は、ResearchがFindingを技術的に確定した後にHuman OSが行う。重複は対象plugin、affected versionの重なり、root cause、attacker-controlled primitive、破壊されるsecurity propertyで判定し、同じclassまたはfileだけで重複にしない。重複であっても技術的Findingと実証記録は保持するが、新規実戦成果や提出候補には数えない。照合で得たCVE、advisory、patch情報をResearchの次iterationへ戻さない。
