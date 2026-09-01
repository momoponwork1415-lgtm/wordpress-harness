---
status: accepted
---

# Separate development and sealed evaluation cohorts

benchmarkをDevelopment CohortとSealed Evaluation Cohortに分ける。旧`whitebox-harness`から再利用する実証済みCaseはDevelopmentへ置き、prompt、rule、effort、harnessの反復調整に使う。production昇格は、構成固定後にだけ実行する未使用のprivateまたはsynthetic WordPress Caseで判定し、そのoracle、vulnerable/patched role、期待routeをworkerと開発loopから隔離する。
