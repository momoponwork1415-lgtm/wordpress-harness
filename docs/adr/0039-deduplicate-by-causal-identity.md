---
status: accepted
---

# Deduplicate by Causal Identity

HypothesisとFindingは、root cause、attacker-controlled primitive、破壊されるsecurity propertyから成るCausal Identityで重複判定する。異なるentry pointまたはsinkでも同じcauseとprimitiveが同じpropertyを破壊する場合は一件へ束ね、同じfileまたはvulnerability classでもcauseかpropertyが異なれば別件とする。束ねたentry、role、contextはvariant lineageとして保持する。
