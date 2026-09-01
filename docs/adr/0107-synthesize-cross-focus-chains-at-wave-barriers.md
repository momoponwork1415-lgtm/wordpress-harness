---
status: accepted
---

# Synthesize cross-focus chains at Work Wave barriers

Finder同士を直接会話させず、terminalになったWork Waveの型付きRoute Fragment、Hypothesis、state transitionをstable Work ID順で専用のChain Synthesisへ渡す。Chain SynthesisはFocus Areaをまたぐ新しいSource-bound HypothesisまたはFrontier Gapを作れるが、既存Fragmentを接続しただけでFindingへ昇格させない。

一つのmodelだけが示したrouteも多数決で破棄せず、source-boundかつ反証可能なら保持する。相反する支持routeと反証routeはconsensusで潰さず別artifactとして残し、決定的Preflightまたは独立Verificationで解消する。これにより独立探索を保ちながら、ATO、Stored XSS、SQL injection等のprimitiveからsite-wide compromiseへ至る少数意見のchainを失わない。
