---
status: accepted
---

# Compose each Work Wave from three exploration lanes

各探索Work Waveを一種類の「RCEを探せ」というassignmentで埋めず、互いに目的の異なる`Frontier Lane`、`Primitive Lane`、`Coverage Lane`から構成する。Frontier Laneは複数primitiveをつないでRCEまたはsite-wide compromiseへ到達するroute、Primitive LaneはSQL injection、Stored XSS、authorization、identity、file、path、deserialization等の独立して価値のある破壊、Coverage Laneは未所有surfaceとmap gapの閉鎖を担当する。

Laneはworker role、model、queue、vulnerability verdictではなく、Focus AreaまたはWork Leaseへ付ける探索目的である。同じModel ProfileをどのLaneにも評価でき、どのLaneのHypothesisも同じVerification Queueとevidence gateへ送る。

eligible workがある限り各Work Waveへ三Laneを最低一つずつ含めるが、等分率を固定しない。Exploration Queueがcoverage gap、novelty、expected information gain、前Waveのevidence、残budgetから追加slotを決める。一Laneが全slotを占有できるのは、他LaneがCoverage Closure、理由付きBlocked、または明示的なscope外になった場合だけとする。

これによりNorth Starへ直接集中する能力を保ちながら、darooの公開portfolioに見られるchain primitiveや未知surfaceを、RCEへ直結しないという理由だけで失わない。
