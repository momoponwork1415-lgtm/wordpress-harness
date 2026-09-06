# Triage Labels

Use these five canonical roles without renaming them.

| Label | Meaning |
| --- | --- |
| `needs-triage` | The owner must evaluate the issue or settle its design. |
| `needs-info` | Required information is missing. State what is needed. |
| `ready-for-agent` | The owner, Interface, failure semantics, and acceptance are sufficiently specified for an agent. |
| `ready-for-human` | The next work requires a human decision or implementation. |
| `wontfix` | The issue will not be actioned. Record the reason. |

- Use one current triage role per issue. Replace the old role when the next action changes; retain independent labels such as `bug`, `enhancement`, and `documentation`.
- `ready-for-agent` does not mean unblocked or authorized to perform external actions. Check native dependencies, assignee, and the issue's explicit constraints.
- A map issue may use `wayfinder:map` without a triage role. Do not mark an unresolved design as ready merely because it is listed under a map.
- Check existing labels with `gh label list` before creating one. Do not rely on a dated inventory in this document. Create a missing canonical label only when it is first needed.
- Wayfinding labels are separate from triage roles: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, and `wayfinder:task`.
