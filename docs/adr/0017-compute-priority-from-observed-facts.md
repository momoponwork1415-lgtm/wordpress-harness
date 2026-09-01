---
status: accepted
---

# Compute priority from observed facts

Exploration QueueとVerification Queueの順位は、Research Ledgerに記録された観測事実からorchestratorが決定的に計算する。単一の0–100 scoreへ圧縮せず、各軸と根拠を保持したlexicographic tupleで比較し、LLM judgementは同順位のtie-breakにだけ使用する。LLMのconfidenceまたはseverity self-ratingをpriority evidenceとして扱わない。
