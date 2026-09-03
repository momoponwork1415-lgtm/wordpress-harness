---
status: accepted
---

# Optimize for high-impact semantic recall before cost

通常のResearchは、特定のsink、CWE、Surface Map nodeを網羅することではなく、`Permitted Attacker`から破られるsecurity propertyをsource semanticsから発見することを最優先にする。RCEまたはsite-wide compromiseは最上位impactだが唯一の成功条件ではない。Unauthenticated SQL injection、意味的に深いStored XSS、account takeover、privilege escalation、arbitrary file operation、object injection、authorizationまたはbusiness-logic failure等、単独でも重大なFindingを同じResearch capabilityの成果として扱う。

> Do not optimize for sinks. Optimize for broken security semantics.

通常運転は一Targetへraw-source-firstの有限`Semantic Research Wave`を行う。Root Plannerは最大4個の重複しないresearch thesisまたは開始lensを割り当てるが、file、surface、脆弱性class、探索手順をscopeとして固定しない。FinderはTarget Snapshot全体へbounded source toolsで自由にpivotする。Surface Map、PHP Program Index、AST、Semgrep、CodeQLはnavigation、evidence、coverage、pattern expansionへ使えるが、non-matchまたはMap外であることをcandidateの拒否、downgrade、安全性、Campaign closureへ使わない。この判断はADR 0113と0116を維持する。

一つのFindingを得ただけでは自動停止しない。十分に重大なsource-bound HypothesisはIndependent Verificationへ送る一方、同じWaveに強い未解決primitiveまたはsecurity-semantic frontierが残る場合は研究を継続できる。単純なReflected XSS等の低優先Findingも、parser、transformation、authorization、state等の再利用可能なmechanismまたはRoute Fragmentを含む場合は記録し、低severityだけを理由に証拠を消さない。

`Depth`は全Targetへ必ず適用する通常モードではなく、`Depth Admission`を通ったfrontierへの追加投資である。最終RCE、ATO、PrivEscが既に見えていることを要求しない。unauthenticatedまたはlow-privilegeな強いread/write/file/auth/state capability、persistent attacker-controlled state、cross-requestまたはcross-actor flow、decode/reparse、producer/consumer mismatch、security assumption mismatch、複数機能を接続できるRoute Fragment、またはCriticが示す具体的missing linkがあれば、高impactへ伸びる可能性としてDepthへ昇格できる。

DepthではRoute Fragmentをdurableに固定し、freshなRoot Synthesisが意味的な接続候補を作り、Adversarial Criticがattacker premise、hop、actor、state identity、security assumptionを攻撃する。Harnessはchainをdeterministic scriptで構築せず、artifact identity、source provenance、freshness、budget、state transitionを強制する。CriticがFindingを昇格させることはなく、成立routeはfresh Independent Verificationへ、具体的な不足linkはfresh missing-link Work Waveへ渡す。

Discoveryの評価優先順位は、当面`high-impact recall -> root-cause quality -> attacker-premise closure -> independent verification -> false-positive behavior -> token/cost`とする。Budget Envelopeは暴走を防ぐhard ceilingとして維持するが、tokenまたはwall timeを減らすためにhigh-impact recallを落とす変更は採用しない。cost、Finder数、context、model allocation、Wave数の最適化は、oracle-separated development casesとprospective Campaignでrecall baselineを作った後に一変数ずつablationする。

評価の骨格には、semantic depthの異なる公開Caseを使う。Simply Schedule Appointments SQLi、Brizy Stored XSS、TranslatePress Stored XSS、TranslatePress account takeoverをdevelopment referenceとして扱い、`Researcher Reference`としてdarooの公開portfolioからRCE、PrivEsc、file、deserialization、SQL、Stored XSS等のhigh-impact mechanism gapを確認する。Researcher Referenceは公開成果水準とcoverageの参照に限り、daroo本人の非公開method、AI利用、worker persona、CVE answerをprospective workerへ推測または入力しない。

PRISM型のBreadth最適化はこのResearch capabilityを多数Targetへ効率よく展開する後段であり、現在のhigh-impact recall確立より先にcritical pathへ置かない。BreadthとDepthを別policyにするADR 0114は維持するが、「Depthを全Targetの主探索とする」という運行優先順位は本ADRで置き換え、通常運転をSemantic Research、必要時だけDepth Escalationとする。

このADRはADR 0075のRCE/site-wide-compromiseのみをNorth Starの完了像とした定義を置き換える。RCEを最上位impactとして追うこと、安全なExecution Canaryを要求すること、prospective unknown discoveryを目指すことは維持する。