# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`CONTEXT.md`** at the repo root — the glossary for the Research context.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. This repo keeps a single system-wide ADR directory; there are no context-scoped ADR directories.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is **multi-context** (a `CONTEXT-MAP.md` exists at the root). Contexts are bounded contexts, not packages, so each glossary lives under `docs/domain/` rather than beside a package's `src/`:

```
/
├── CONTEXT-MAP.md          ← index of the three contexts
├── CONTEXT.md              ← glossary for the Research context
├── docs/
│   ├── adr/                ← system-wide decisions
│   └── domain/
│       ├── target-intelligence/CONTEXT.md
│       └── human-os/CONTEXT.md
└── src/
```

## Repository-specific gate

`pnpm docs:check` requires every relative Markdown link to resolve to an existing file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the owning `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0113 (keep Finder methods free behind an Evidence Shell) — but worth reopening because…_

This repo supersedes decisions with a new ADR rather than editing the old one, so say which ADR you would supersede.
