---
status: accepted
---

# Preflight before Lab and check duplicates after Finding

高価な隔離検証と追加modelの前に、固定sourceからsymbol実在、entry到達性、attacker role、capability・nonce防御、sink接続を事前検査する。不成立を決定的に証明できた時だけHypothesisをDisprovedにし、判定不能は検証待ち行列に保持する。隔離検証はimpact、到達根拠、次の決定的Experiment、費用、coverageの上位から実行し、未選択を却下に読み替えない。Wordfence等の既知脆弱性との重複照合はFinding成立後だけHuman OSで行い、Researchへoracleを戻さない。
