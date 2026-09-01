---
status: accepted
---

# Expose only a harness-owned Experiment MCP

Native agent processからtrusted Experiment Brokerへ到達する共通tool境界は、harnessが所有するlocal stdio MCP server一つとする。providerごとのtool protocolをCampaign coreへ持ち込まず、各CLI adapterはCampaign開始時にhash固定した同じMCP manifestをnative configへ変換する。

Discovery AttemptにはExperiment MCPを渡さない。Verifierと必要なSkeptic Attemptだけに、Work LeaseとHypothesis mechanismに対応する最小のversioned Experiment tool集合を渡す。各tool inputはruntime schemaで検証し、Work Lease、Target Snapshot、Experiment kind、budget reservationへ結び付けてからLab operationへ変換する。tool outputはtyped observationとartifact referenceに限定する。

user/global configから継承されるMCP server、plugin、hook、memory、web toolは無効にする。MCP serverはcontainer socket、credential value、Research Ledger writerをAgentへ公開せず、unknown tool、schema mismatch、lease mismatch、budget超過を実行前に拒否する。全request/responseとpolicy decisionをprivate CASへ保存する。

source探索用の`rg`、parser、短い解析scriptまでMCP化しない。これらはAgent Sandboxのread-only sourceとAttempt scratch内で、許可されたbuilt-in toolまたはBashから利用できる。MCPはcross-zone side effectを伴う安定したExperiment capabilityだけに使う。
