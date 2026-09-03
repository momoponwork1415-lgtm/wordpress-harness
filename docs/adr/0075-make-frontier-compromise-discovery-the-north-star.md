---
status: superseded by ADR 0117
---

# Make frontier compromise discovery the north star

このprojectのNorth Starは、既知脆弱性のoracleなしに、Permitted Attackerから任意code executionまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立Verificationで実証できる`Frontier Discovery Capability`である。これはWordfence Argusが掲げる「最も危険なWordPress脆弱性を発見する」姿を、こちらの攻撃者前提とevidence contractへ具体化する。

RCEは最上位の代表mechanismだが、category名だけで危険度を決めない。実際のattacker precondition、到達可能性、破壊されるsecurity property、Witnessでpriorityを決める。SQL injection、Stored XSS、account takeoverも独立した重要Findingであり、site-wide compromiseへのchainまたは探索・検証能力を構成するmechanismとして継続して扱う。

Milestone 1のStored XSSはbrowser、state、Witness、Causal Controlを含むclosed loopの最小実証であり、最終能力の代用ではない。公開Development Caseの再発見、static rule match、既知variantの回収だけでもNorth Star達成とは呼ばない。少なくとも一つのprivate RCE Boundary Pairで安全なRCE Experimentを成立させた後、oracle-freeのprospective Campaignで未知の重大routeをHuman Confirmationまで到達させることを目標とする。

このため設計は、単一fileのsink検出だけでなく、cross-file、cross-request、persistent state、dynamic dispatch、configuration、複数primitiveをつなぐHypothesisを失わない。RCE Witnessは使い捨てLab内の無害なcanary effectに限定し、interactive shell、host到達、許可外egressを成功条件にしない。
