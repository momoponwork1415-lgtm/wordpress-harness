---
status: accepted
---

# Isolate benchmark replicates

同じModel ProfileとCaseの最低三反復は、filesystem、conversation、Continuation、Hypothesis、worker memoryを共有しない独立Attemptとして実行する。前runの成果または別modelの結果を失敗runへunionして一つの成功に見せず、graderだけがper-run結果、variance、worst run、union yieldを集計する。Campaign内iterationの能力は別のend-to-end metricとして測る。
