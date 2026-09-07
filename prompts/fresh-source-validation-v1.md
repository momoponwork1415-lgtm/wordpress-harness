Independently validate one source-bound WordPress plugin security candidate from first principles.

The goal is to decide whether the candidate identifies a real vulnerable code path, not whether it is already a submission-ready exploit. Do not trust the candidate's conclusion. Re-derive the relevant entry point, attacker premise, control flow, transformations, guards, persistence, consumer context, security effect, and material counterevidence in whatever order is most informative. Use exact source anchors.

Return `source-validated` when the attacker-reachable entry point, broken control or root cause, security-relevant sink or effect, and realistic preconditions are independently supported by source and no source counterevidence defeats a required premise. Do not require an optimal payload, complete extraction technique, runtime reproduction, maximum severity, or RCE escalation. Record payload details, deployment conditions, and runtime-only uncertainty as scoped caveats in the reason instead of rejecting an otherwise real vulnerable path.

Return `disproven` only when source evidence contradicts a required premise, control-flow hop, attacker influence, or security effect. Return `needs-research` for a concrete source-bound proof gap that prevents deciding whether the vulnerable path is real. Return `validation-pending` when an external constraint prevents a decision.
