---
status: accepted
---

# Start Verification with one canonical runtime

各Campaignは最初に一つのcanonical WordPress/PHP/MySQL runtime tupleをhash固定し、すべての初回Experimentを同じ基準環境で行う。対応versionのfull matrixを事前に作らず、WordPress、PHP、database、dependencyのversion差がHypothesisの成立条件としてsourceまたはExperimentに現れた場合だけ追加runtimeを作る。Findingは成立した正確なruntime tupleを参照する。
