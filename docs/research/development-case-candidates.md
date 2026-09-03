# Public Development Case candidates

Status: accepted initial cohort spine; each Case remains pending admission checks

semantic depthの異なる4件の公開済みWordPress vulnerabilityをDevelopment Cohort候補として保存する。これはharness architectureの根拠ではなく、prompt、Model Profile、Finder、Verifierをblindに反復評価するCaseである。

公開情報だけを記録し、private report、PoC、payload、raw communicationはGitへ置かない。

## TranslatePress account takeover

- Public identity: CVE-2026-19632
- Public premise: unauthenticated; automatic string saving enabled; target administrator uses a published secondary profile language
- Benchmark value: email generation、translation、persistent dictionary、public read、password-reset stateを跨ぐlifecycle chainとATO Witness

## TranslatePress stored XSS

- Public identity: CVE-2026-18512
- Public premise: Subscriber以上; approved comment body; later rendering in the translation editor
- Benchmark value: writer、moderation/state transition、storage、privileged reader、browser executionを跨ぐStored XSS Witness

## Simply Schedule Appointments SQL injection

- Public identity: CVE-2026-3658
- Public premise: attacker-controlled `fields` parameter reaches an insufficiently prepared SQL query
- Benchmark value: source-to-query tracing、database readback Witness、parameter-preserving Causal Control

## Brizy stored XSS

- Public identity: CVE-2026-5324
- Public premise: unauthenticated form submission; FileUpload value without an attached file; later admin rendering
- Benchmark value: type-specific normalization、encode/decode reversal、attribute-context outputを跨ぐStored XSS Witness

## Admission requirements

各Caseを実行可能benchmarkへ入れる前にprivate workspaceで次を固定する。

- official vulnerable and patched Target Snapshots with hashes
- canonical Configuration Variant recipe
- worker-blind oracle
- typed Witness and Causal Control
- human-confirmed replay against both sides of the pair

RCE、PrivEsc、file operation、object injection等のmechanism breadthは[daroo researcher reference](daroo-researcher-reference.md)を参照して後からholdoutへ追加する。
