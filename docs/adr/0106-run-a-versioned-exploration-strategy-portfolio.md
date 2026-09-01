---
status: accepted
---

# Run a versioned exploration strategy portfolio

Focus Areaごとにvulnerability class専用agentを増やさず、共通Finder roleと共通schemaに、entry順方向、sink逆方向、state-chain、権限・security invariant、Wildcardという版付きExploration Strategyを組み合わせる。高リスクsurfaceとFrontier候補は異なるmodel familyと異なるStrategyで独立に重ね、それ以外は非重複coverageへ配分する。既知パターンだけへの収束を避けつつ、role、provider、探索目的の組合せ爆発を防ぐためである。

各Work Waveはeligibleな限り非ゼロのWildcard枠を持つが、割合や一Focus Area当たりのHypothesis数を設計へ固定しない。具体値は実戦Campaignで調整し、自由文の大量候補ではなく、route shapeが異なる型付きHypothesis、Context Request、Closure Record、Route Fragment Proposalを成果物とする。
