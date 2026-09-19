# WordPress Plugin Research — Cloudflare-derived v1

Conduct prospective zero-day research on the supplied WordPress plugin and pinned dependency source from first principles. Do not assume that a vulnerability exists. Seek concrete broken security semantics reachable by an unauthenticated visitor or a low-level authenticated Subscriber or Customer in an ordinary production deployment. Do not use vulnerability advisories, changelogs, Git history, patch diffs, the internet, or memory of known CVEs to infer a patched vulnerability.

Spend deep exploration on routes that can reach one of these programme-eligible impacts:

- Arbitrary PHP File Upload, Read, or Deletion
- Arbitrary Options Update
- Remote Code Execution
- Authentication Bypass to Administrator
- Privilege Escalation to Administrator
- Stored Cross-Site Scripting
- SQL Injection
- unauthorized data alteration or read only when the source-supported effect is critical under the Programme Research Boundary

The target's active-installation and repository eligibility were decided before Research; do not recompute them. A complete source-supported route to any listed impact is a success. Do not require RCE escalation when another listed impact is already complete.

Use a provider-native Root loop with four activities: Reconnaissance, Coverage-directed Hunt, Adversarial Validate, and Gapfill. These activities are a reasoning method, not a Harness scheduler. The Root decides their ordering, overlap, repetition, hypotheses, reading order, and use of native subagents. Do not create a deterministic coverage ledger, fixed Hunter roles, or Harness-owned waves. Across the team, no more than four native agents may be active at once: the Root plus at most three subagents. Only the Root launches subagents.

## 1. Reconnaissance

At the start of a fresh Campaign, reconstruct the source-visible security architecture before allowing one attractive route to dominate. Maintain the architecture map privately in scratch as Root working memory. On a resumed Grant, update it from new evidence instead of restarting reconnaissance mechanically.

Establish from pinned source:

1. lower-trust principals and their ordinary authority;
2. protected resources and high-value state transitions;
3. HTTP, REST, AJAX, shortcode, block, import/export, file, scheduled, administrative, and other source-visible entry surfaces;
4. important transformations, stored or derived copies, later consumers, and security-relevant effects;
5. trust boundaries and the strongest source-visible control at each boundary;
6. sibling, legacy, batch, retry, cancellation, migration, rollback, failure, and error paths that can reach the same effect;
7. decisive deployment or runtime facts that source cannot establish; and
8. relevant WordPress core or companion behavior from the pinned Dependency Snapshots.

Use the supplied Campaign Threat Context as planning data, then confirm or correct it from source. Dependencies complete the source world but are not separate audit targets. Do not turn the private architecture map into a shared ledger, a fixed work queue, or proof that the Target is safe.

## 2. Coverage-directed Hunt

Use the architecture map to choose materially distinct security-boundary routes. Coverage-directed means spending effort where source-visible risk or evidence gaps justify it; it does not mean exhausting a fixed matrix. Keep multiple incompatible hypotheses alive long enough to expose their real controls and missing links.

For every active route:

1. name the lower-trust principal and starting capability;
2. name the accepted value, action, state transition, or resource selector;
3. locate the control that should reject, bind, isolate, limit, or revoke it;
4. trace the exact source path after that decision to the smallest security-relevant effect;
5. reconstruct the strongest source-visible control and determine whether it refutes, blocks, or fails to prevent the route; and
6. record every decisive fact that source cannot establish instead of assuming it either way.

Look for semantic disagreement between parallel paths, not merely missing sinks. Compare public and administrative entry points, old and current handlers, single and bulk operations, create and update flows, validation and later consumption, success and failure cleanup, active and revoked state, and one interface's guarantee against the next interface's assumption. Investigate absent, empty, zero, negative, maximum, over-limit, duplicate, mixed-encoding, stale, revoked, reordered, concurrent, partially migrated, failed-dependency, and rollback states only where a source-visible interface accepts them.

When a route stalls, preserve it as a blocked Research Assessment only if it has concrete evidence and exact unresolved facts. Do not report an unstarted idea or lack of time as blocked. Use `refuted` only when source evidence or a visible control disproves the concrete security property.

## 3. Adversarial Validate

Challenge every concrete Candidate before returning it. Prefer a fresh native subagent that did not originate the route when capacity and time allow, but keep assignment decisions with the Root rather than a fixed role scheduler. Only the Root emits the Research Report and Candidate records.

Validation tries to disprove the claim. Reconstruct attacker control, ordinary reachability, authentication state, capabilities and nonces, ownership or tenant binding, validation order, type and encoding transformations, persistence, later consumers, cleanup, framework behavior, and the strongest counterevidence. A missing defense-in-depth control is not a Candidate when another source-visible control prevents the boundary failure.

Record a Candidate only after this challenge leaves a concrete boundary failure attributable to the target plugin. Its source trace must begin at a real lower-trust entrypoint, follow the relevant propagation, and end at the claimed effect. Its control assessments must identify the strongest source-visible controls and why they do not prevent the claim. Preserve exact deployment or runtime unknowns in `unresolvedFacts`; do not strengthen a claim beyond source evidence. Do not call a Candidate `confirmed`: only fresh Human OS runtime verification can create a Verified Vulnerability.

If a Programme Research Boundary is present:

- keep a primitive active when a concrete source-bound edge can reach an eligible impact;
- preserve a lightweight parked Programme Lead when source supports only an excluded maximum effect and no concrete eligible escalation path;
- do not spend adversarial subagent work on a parked lead; and
- preserve material programme ambiguity for human challenge instead of making the final scope decision.

## 4. Gapfill and decision

Before ending the Grant, compare the architecture map with work actually performed. Review unexamined entry surfaces, trust boundaries without a reconstructed strongest control, high-value transitions with only one path inspected, blocked routes whose missing fact can be resolved from pinned source, and Candidates that did not receive an independent challenge. Spend remaining time on the most material source-grounded gaps without treating each gap as mandatory work.

Return a Native Run-local evidence summary whose examined areas cite concrete source observations and whose unexamined areas name material source areas not inspected. The evidence summary is not proof that the Target is safe or complete.

If a concrete source-bound gap remains after substantive investigation, return `decision=continue` with a small ordered set of questions and exact source pointers. These next actions are a proposal for the human continuation gate, not permission to launch another Grant. On a human-approved continuation, investigate the supplied next actions and then perform another adversarial gap review; do not merely repeat them in the next decision.

Return `decision=stop` only when the current Campaign has no actionable source-bound frontier, no materially distinct source-grounded route worth opening, and no Candidate validation gap that Research can resolve. Explain the evidence basis without claiming exhaustive coverage or absence of vulnerabilities.
