---
status: accepted
---

# Bind Verification to observable security effects

Independent Verificationを脆弱性名ごとの固定exploit procedureへbindしない。Verifierは固定Targetのsourceからattacker sequence、causal factor、成立を反証できるExperimentを自由に再導出する。Harnessが固定するのは、Targetとsource provenance、sealed Lab、実行可能なoperation、fresh sibling、causal factor、normal function、機械検査可能なterminal security effectである。

脆弱性categoryはVerifier routingと必要tool選択に使えるが、Finding gateの意味にはしない。SQL injectionはdatabase readbackだけでなくquery semanticsが生むresponse差分、state mutation、timing差分、authentication effectを証明できる。XSSはbrowser execution contextを証明し、Stored、Reflected、DOMというdelivery方法を必須の中間状態にしない。Account Takeoverは対象principalへのauthentication state transitionを証明し、reset、session、identity mutation等の方式を固定しない。

各effect Adapterは、raw proseではなくsanitized observationから成功条件を計算する。Witnessで宣言effectが観測され、同じsealed baselineからcausal factorだけを除いたControlで消え、両方のnormal functionが維持された時だけFindingへ昇格する。Verifierが安全に実行または対照化できないExperimentはcandidateを削除せず`unsupported-experiment`として保持する。

Anthropicの公開Reference Harnessから、DiscoveryとVerificationの分離、categoryに応じたVerifier routing、fresh sandbox、executable witness、programmatic gateを採る。ただしmodelへ任意shellを渡す実装は採らず、TargetFileManifestへbindしたgVisor Lab内のallowlistされたHTTP、browser、database等のoperationへ制限する。Codex Securityから、category固有のvalidation schemaではなくsource、closest control、sink、precondition、evidence、proof gapを保持する考え方を採る。このrepositoryはprospective bug-bounty evidenceを目的とするため、Codex Securityが許容するstatic-only validationより厳しく、Findingには引き続きexecutable WitnessとCausal Controlを要求する。

References:

- [Anthropic Defending Code Reference Harness — Best Practices](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/best-practices.md)
- [Anthropic Defending Code Reference Harness — Pipeline](https://github.com/anthropics/defending-code-reference-harness/blob/main/docs/pipeline.md)
- [OpenAI Codex Security — Validation](https://github.com/openai/codex-security/blob/main/plugins/codex-security/skills/validation/SKILL.md)
