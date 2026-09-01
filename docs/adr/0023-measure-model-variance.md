---
status: accepted
---

# Measure model variance

各Model Profileは同じbenchmark Caseで最低三回実行し、per-run性能、variance、worst run、三回のunion yieldを別々に記録する。unionだけを能力scoreにすると、不安定で高コストな多重実行が過大評価されるため、単発の安定性と反復による追加yieldを分離する。三回を超える反復はmarginal verified yieldと費用から判断する。
