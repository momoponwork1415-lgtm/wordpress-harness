---
status: accepted
---

# Require an executable Witness for every Finding

すべてのFindingは、固定Target Snapshotから構築したcleanなlocal WordPress環境で、security propertyの破壊を客観的に示すWitnessを必要とする。source argument、finderまたはverifierのverdict、既存logだけではFindingへ昇格させない。実行環境を構築できない、必要条件を制御できない、またはtoolingが壊れた場合は脆弱性を否定せずBlockedとして記録する。
