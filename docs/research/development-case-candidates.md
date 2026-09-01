# Public Development Case candidates

Status: Accepted initial cohort spine; each Case remains pending admission checks

この一覧は、ユーザーから提供された公開済みWordPress vulnerabilityをDevelopment Cohort候補として保存する。3件の[Design references](../REFERENCES.md)とは役割が異なり、harness architectureの根拠ではなく、prompt、Model Profile、Finder、Verifierを反復調整するCaseである。

この4件を初期Development Cohortの骨格とする。各Caseは下記admission checkを満たすまで実行可能benchmarkには昇格しない。RCE Caseはprivate workspaceでvulnerable/patched両側を人間再現できた時点で追加する。

現在のactive deliveryでは、この4件を日常調整可能なDevelopment Cohortとして使い、daroo由来のWP Statistics Stored XSSとWPGraphQL SQL injectionを別のholdout候補として扱う。候補の一次資料と選定根拠は[daroo public Case candidates](daroo-public-case-candidates.md)、実行順と合格条件は[First closed vertical slice goal](../design/first-closed-slice-goal.md)を正本とする。

公開情報だけを記録し、提出時のprivate report、PoC、payload、raw communicationはGitへ置かない。

## First admitted public Boundary Pair

最初のend-to-end acceptance CaseはBrizy Page Builderとする。

- vulnerable positive: 2.8.11
- actual patched negative: 2.8.12
- benign control: 同じform/fileUpload surfaceの正常機能
- primary Witness: unauthenticated inputから保存された値によるbrowser script execution
- decision: [ADR 0070](../adr/0070-use-brizy-stored-xss-as-the-first-public-boundary-pair.md)

## TranslatePress account takeover

- Advisory: [TranslatePress – Multilingual <= 3.3.1 - Unauthenticated Account Takeover via Password Reset Link Disclosure](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/translatepress-multilingual/translatepress-multilingual-331-unauthenticated-account-takeover-via-password-reset-link-disclosure)
- Technical article: [400,000 WordPress Sites Affected by Account Takeover Vulnerability in TranslatePress WordPress Plugin](https://www.wordfence.com/blog/2026/08/400000-wordpress-sites-affected-by-account-takeover-vulnerability-in-translatepress-wordpress-plugin/)
- Public identity: CVE-2026-19632; affected `<= 3.3.1`; patched `3.3.2`
- Public premise: unauthenticated; automatic string saving enabled; target administrator uses a published secondary profile language
- Benchmark value: email generation、translation、persistent dictionary、public AJAX read、password-reset stateを跨ぐlifecycle chainとATO Witness

## TranslatePress stored XSS

- Advisory: [TranslatePress <= 3.2.6 - Authenticated (Subscriber+) Stored Cross-Site Scripting via Approved Comment Body in Translation Editor](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/translatepress-multilingual/translatepress-326-authenticated-subscriber-stored-cross-site-scripting-via-approved-comment-body-in-translation-editor)
- Public identity: CVE-2026-18512; affected `<= 3.2.6`; patched `3.3`
- Public premise: Subscriber以上; approved comment body; later rendering in the translation editor
- Benchmark value: writer、moderation/state transition、storage、privileged reader、browser executionを跨ぐStored XSS Witness

## Simply Schedule Appointments SQL injection

- Advisory: [Appointment Booking Calendar <= 1.6.10.0 - Unauthenticated SQL Injection via `fields` Parameter](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/simply-schedule-appointments/appointment-booking-calendar-16100-unauthenticated-sql-injection-via-fields-parameter)
- Public identity: CVE-2026-3658; affected `<= 1.6.10.0`; patched `1.6.10.2`
- Public premise: unauthenticated; attacker-controlled `fields` parameter reaches an insufficiently prepared SQL query
- Benchmark value: source-to-query tracing、database readback Witness、parameter-preserving Causal Control

## Brizy stored XSS

- Advisory: [Brizy – Page Builder <= 2.8.11 - Unauthenticated Stored Cross-Site Scripting via FileUpload Field Value](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/brizy/brizy-page-builder-2811-unauthenticated-stored-cross-site-scripting-via-fileupload-field-value)
- Public identity: CVE-2026-5324; affected `<= 2.8.11`; patched `2.8.12`
- Public premise: unauthenticated form submission; FileUpload value without an attached file; later admin rendering
- Benchmark value: missing nonce、type-specific normalization gap、encode/decode reversal、attribute-context outputを跨ぐStored XSS Witness

## Still required before admission

各CaseをDevelopment Cohortへ入れる前に、次をprivate workspaceで再構築する。

- official vulnerable and patched Target Snapshots with hashes
- canonical or named Configuration Variant recipe
- worker-blind oracle
- typed Witness and Causal Control
- human-confirmed replay against both sides of the pair
- role-level task views for Mapper、Finder、Verifier、Skeptic
