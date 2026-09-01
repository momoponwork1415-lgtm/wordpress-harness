---
status: accepted
---

# Represent each Hypothesis with an Evidence Route

各Hypothesisはrouteを自由文だけで説明せず、一つのattacker premiseから一つのsecurity impactまでを結ぶ最小のtyped causal subgraphである`Evidence Route`を持つ。これはTarget全体のcall graphではなく、主張の成立または反証に必要な部分だけを表す。

初期node kindは`attacker-control`、`entry`、`guard`、`transform`、`state-write`、`state-read`、`dispatch`、`sink`、`impact`とする。edgeはcall、data flow、control、registration、persistence、reload、dispatch、enablement等の関係を表す。cross-request routeは一つの曖昧なedgeにせず、state-writeとstate-readを別nodeにして、保存identityと各request premiseを残す。

nodeとedgeは`observed`、`inferred`、`unknown`のevidence stateを持つ。observedはTarget Snapshotのdigest付きsource range、PHP Program Index fact、またはExperiment evidenceを参照する。inferredは推論根拠とfalsifier、unknownは不足factと次のExperimentを必要とする。Discovery Hypothesisはinferredとunknownを含めてよいが、Findingへ昇格するessential routeにunknownを残さず、Verifierが各essential relationを独立に再導出する。

一つのEvidence Routeは一つの最小claimに保つ。異なるroot cause、別のterminal impact、または独立に反証できるalternative routeは別Hypothesisにし、Causal Identityで関連付ける。巨大な全source graph、model transcript、confidence numberをroute evidenceとして扱わない。

schema versionとcanonical orderingを固定し、同じTarget Snapshotと同じfactsから同じroute digestを作る。Static Rule matchは不完全なEvidence Routeを持つHypothesisを作れるが、欠けたentry、guard、state、impactをrule自身が証明したことにはしない。
