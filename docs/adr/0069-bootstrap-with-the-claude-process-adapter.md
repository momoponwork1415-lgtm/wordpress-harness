---
status: accepted
---

# Bootstrap with the Claude process adapter

最初のend-to-end vertical sliceは、`NativeAgentProcessTransport`のClaude process adapter一つと、Opus candidate Model Profile一つで実装する。`claude -p`のversion固定argv、effective config、structured event stream、session Segment、usage、termination、gVisor実行を先にcontract化し、Campaign loopとVerification evidenceを同時に複数provider差へ晒さない。

vertical sliceがDevelopment Boundary Pairを完走し、crash resume、budget、Witness、Causal Control、Skeptic、Ledger replayを満たした後、同じClaude process adapterへ分離したGLM Model Profileを追加する。その後にCodex process adapter、Grok process adapterの順で追加し、すべてへ共通contract suiteとprovider固有capability probeを適用する。

この順序は最終的なrole別model選定を先取りしない。[ADR 0089](0089-start-prospective-campaigns-after-minimal-calibration.md)に従い、4候補×全roleの事前benchmarkは行わず、Opusをbootstrap baselineとして実戦Campaignを開始する。後続modelはcapability probe、共通contract suite、小さなBoundary Pair smokeを通した後、実戦の必要roleへ追加する。production profileの正確なmodel slugとeffortは各Campaign前に固定する。
