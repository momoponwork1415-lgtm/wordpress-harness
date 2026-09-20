---
status: accepted
supersedes: [0127, 0130, 0131]
---

# 採用したCandidateをruntime verificationで昇格する

Research Rootがすでにsourceから導いたCandidateを、別のsource-only Agentに再導出させない。RootはCandidateと同じResearch runでCandidate-boundなprivate reproduction recipeを作る。人間がCandidateをadmitした後、Human OSがfreshな使い捨てWordPress環境でそのrecipeを一度だけ実行する。`runtime-confirmed`からだけVerified Vulnerabilityを生成する。

Programme scopeは技術的な真偽と別に扱う。Verified Vulnerabilityを全configured programmeのscope snapshotへ照合し、`in-scope`、`out-of-scope`、`ambiguous`または`stale`を記録する。全programmeでOOSでもVerified Vulnerabilityは保持し、Submission Candidateは`in-scope`のprogrammeにだけ作る。scope評価の失敗もVerified Vulnerabilityを取り消さない。

Recipe本文、payload、正確なrequestはGit外のcontent-addressed storeへ置き、Research Recordにはdigest-bound参照だけを残す。recipeがないCandidateは棄却せず`verification-preparation-needed`とする。Candidate Reviewはadmitまたはconcrete next action付きのResearch returnだけを決め、programme scopeを先取りしない。

これにより、同じsource reasoningの二重実行を減らし、昇格条件を実際の到達可能性とsecurity effectへ移せる。代償として独立したsource再読による冗長性を失い、fresh runtime、通常構成、recipe品質がpromotionの依存になる。環境、依存、手順、観測、cleanupまたは証拠の不足は`incomplete`として残し、反証へ丸めない。

この判断は、以前のsource-only再確認、source-only Finding生成、programme scopeによるpre-verification holdを置き換える。候補の採否と外部行動のHuman Gateは維持する。Native RunごとのHuman Reviewは、[ADR 0143](0143-continue-research-without-per-run-human-review.md)により廃止された。
