# WordPress Plugin Research v4

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

Use native subagents aggressively when they can produce real parallel investigation or adversarial checking. The root dynamically chooses their tasks; do not use a fixed assignment such as a fixed number of agents for one strategy. Across the team, no more than four native agents may be active at once: the root plus at most three subagents. Only the root launches subagents.

Before allocating deep work, build and maintain a private source-derived architecture summary in scratch. Identify lower-trust principals and their ordinary authority, protected resources, entry surfaces, trust boundaries, high-value state transitions, the strongest source-visible controls, and decisive facts that source cannot establish. Use the supplied Campaign Threat Context as planning data, then confirm or correct it from the pinned source. This summary and the Approach Family Registry are Root working memory, not Harness coverage units or evidence that the Target is safe.

Manage the search with these heuristics:

- Begin with a genuinely diverse portfolio grounded in the plugin. Explore request and input parsing, charsets, REST/AJAX and direct entry points, capabilities and nonces, validation order and type confusion, query construction, stored state and later consumers, output contexts, file uploads and operations, serialization and deserialization, caching, races, encryption sanity checking, typing, mass assignment, error handling, built-in routes, and any other meaningfully attacker-facing surface you identify. These are idea prompts, not a sink checklist.
- Maintain an explicit scratch registry of approach families, grouped by the underlying research idea rather than superficial wording. Track active routes, blocked routes, Candidates, parked Programme Leads, concrete evidence, counterevidence, and remaining gaps.
- If many agents converge on one approach family, redirect some toward underexplored families. Do not let one route dominate merely because it initially appears promising or suspicious.
- When an approach stalls, mark it blocked. Reopen it or assign more work only when someone proposes a materially new mechanism, construction, or source-grounded idea.
- Keep several incompatible routes alive through multiple rounds. Let independent investigations develop far enough to reveal their real strengths and gaps before cross-pollinating their ideas.
- Use adversarial subagents throughout. Double-check every concrete bug by challenging attacker control, reachability, privileges, guards, transformations, persistence, consumers, ordinary-deployment preconditions, and counterevidence.
- The root repeatedly synthesizes results, challenges assumptions, redirects effort, and launches new rounds. Failure of the current approaches or the first wave is not a reason to stop. Search for fresh source-grounded ideas and chain intermediate bugs when they can connect to an eligible impact.

Work from a concrete security invariant for every active route:

1. Name the lower-trust principal and its starting capability.
2. Name the accepted value, action, state transition, or resource selector.
3. Locate the control that should reject, bind, isolate, limit, or revoke it.
4. Trace the exact source path after that decision to the smallest security-relevant effect.
5. Reconstruct the strongest source-visible control and explain whether it refutes, blocks, or fails to prevent the route.
6. Record every decisive fact that source cannot establish instead of assuming it either way.

Read sibling, legacy, batch, retry, cancellation, migration, rollback, failure, and error paths that can produce the same effect. Compare controls for semantic equivalence rather than mere presence, and compare what one interface guarantees with what the next assumes. Test absent, empty, zero, negative, maximum, over-limit, duplicate, mixed-encoding, stale, revoked, reordered, concurrent, partially migrated, failed-dependency, and rollback states only where the source-visible interface accepts them. For a multi-step route, establish each step as a prerequisite and do not assume the later boundary.

Read pinned dependency source to establish framework, library, PHP, database, or companion-component behavior instead of relying on memory or internet lookup. Dependencies complete the source world and may reveal a missing link in a chain, but they are not separate audit targets; report only security claims attributable to the target plugin. Do not invent unlikely configuration assumptions or attacker capabilities.

Triage a discovered primitive before spending deep reasoning on it:

- If it has a concrete source-bound edge to an eligible impact, keep it as an active route. Trace the route end to end and adversarially challenge it.
- If the Programme Research Boundary is present and source currently supports only an excluded maximum effect with no concrete edge to an eligible impact, preserve a lightweight `parkedProgrammeLead` with its attacker premise, primitive, exact evidence, maximum source-supported effect, and `eligibleEscalationAssessment=no-concrete-source-bound-path`. Do not delegate a parked Programme Lead to a subagent or adversarially validate it. Promote it only when a concrete source-bound edge reaches an eligible impact.
- If programme eligibility remains materially ambiguous after focused source review, preserve the route for human challenge rather than silently dropping it.

Trace the exposed state across its full source-visible lifecycle before parking it. Do not infer the maximum effect only from the immediate endpoint or first consumer. For a read primitive, inspect every material producer of the exposed store and determine whether authentication material, tokens, non-public content, or other protected data can enter it through ordinary workflows. For a write primitive, inspect the privileged consumers of the modified state and any later parsing, rendering, authorization, or execution decision. Record concrete negative evidence when those composition edges are closed. This is a focused source review of the primitive's maximum effect, not a sink checklist or an adversarial Candidate review.

Record a Candidate only after it survives source-level adversarial review. Its `sourceTrace` must start at a real lower-trust `entrypoint`, use `propagation` only for intermediate steps, and end at the claimed `effect`. Its `controlAssessments` must include the strongest source-visible controls and explain why each does not prevent the claim. Put exact remaining deployment or runtime facts in `unresolvedFacts`; use an empty array when none remain. Continue Research while a concrete source-bound active frontier or materially different source-grounded approach remains, even when a Candidate is ready. On a continuation Native Run, return only Candidates and parked Programme Leads first established during that run. The Harness retains earlier records. Do not re-emit them. If new evidence materially revises an earlier record, preserve the earlier record and return the revision under a new ID.

For a materially investigated route that does not become a Candidate during this Grant, return a Research Assessment:

- use `disposition=refuted` only when source evidence or a visible control disproves the concrete security property;
- use `disposition=blocked` only when a source-grounded route remains undecidable because one or more exact facts are missing, and list those facts in `unresolvedFacts`;
- do not use `blocked` for a speculative idea, lack of time, or an unstarted reading plan.

Research Assessments are Native Run-local evidence summaries. Do not re-emit an earlier run's Assessment, turn Assessments into a Harness work queue, or treat their count as Coverage or proof that the Target is safe.

Every report must include a run-local `evidenceSummary`. In `examinedAreas`, name source areas actually inspected during this run and cite at least one concrete source observation for each area. In `unexaminedAreas`, name material Target areas not inspected during this run; use an empty array only when none are known. This summary records evidence boundaries. It is not a Harness work queue, a coverage ledger, or proof that the Target is safe.

Before stopping, review the private architecture summary and approach-family registry for underexplored families, unexplained source behavior, remaining gaps, and fresh constructions. Stop only when no actionable frontier or materially new source-grounded approach remains, and explain that evidence basis. Do not merely return because current approaches failed or agents reported no findings.
