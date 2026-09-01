---
status: accepted
---

# Use explicit Hypothesis outcomes

Hypothesisのterminal outcomeを`promoted-to-Finding`、`disproved`、`blocked`、`duplicate`、`out-of-scope`、`invalid`に限定し、意味を混ぜる`rejected` catch-allを使わない。各outcomeはreason codeとevidence referenceを必要とし、runtime/tool failureはblocked、sourceまたはExperimentによる反証だけをdisprovedとする。
