---
status: accepted
---

# Evaluate every candidate model in every role first

GLM 5.3、Grok 4.6、`gpt-daybreak-blue-latest`、Opus 5の初回評価では、すべてをMapper、Finder、Verifier、Skepticの全roleで同じbenchmarkにかける。model familyへの先入観でroleを固定せず、capability、precision、variance、latency、costの実測後にproduction候補を絞る。effort比較は各modelの基準Profileを定めた後に行う。
