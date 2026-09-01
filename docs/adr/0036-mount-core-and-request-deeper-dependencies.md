---
status: accepted
---

# Mount WordPress core and request deeper dependencies

Discoveryにはcanonical runtimeと一致するWordPress core sourceとplugin同梱dependencyをread-onlyで常時与える。PHP、MySQL、外部module等の大きなdependency sourceは常時mountせず、workerが理由、解決したいunknown、必要範囲を持つContext Requestを提出した後、Setupがhash固定して次Attemptへ追加する。Research中の直接network fetchとmodel memoryによる補完を許可しない。
