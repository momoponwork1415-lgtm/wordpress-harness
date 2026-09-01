---
status: superseded by ADR-0089
---

# Use four public Cases as the Development Cohort spine

初期Development Cohortの骨格を、公開済みのTranslatePress account takeover、TranslatePress Subscriber Stored XSS、Simply Schedule Appointments unauthenticated SQL injection、Brizy unauthenticated Stored XSSの四Caseとする。公開advisoryはidentityと公開factだけに使い、Target Snapshot、oracle、PoC、Witness、Causal Controlはprivate workspaceで独立再構築する。RCE等の追加Caseは、vulnerable/patched両側を人間が再現した後にDevelopmentへ加える。
