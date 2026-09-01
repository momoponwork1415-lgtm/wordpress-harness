---
status: accepted
---

# Separate Coverage Closure from resource exhaustion

CampaignをCompletedにできるのは、全Focus Areaがclosedまたは理由付きblockedとなり、独立した二回のgap passで新しいsurface、source-bound Hypothesis、priority変化が生じないCoverage Closureだけとする。wall time、token、cost、worker failureによる終了はIncompleteとして残し、Findingがゼロでも探索完了やtechnical negativeへ読み替えない。Coverage ClosureしたCampaignはFindingゼロでもCompletedになれる。
