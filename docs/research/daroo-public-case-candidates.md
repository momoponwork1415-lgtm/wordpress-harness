# daroo public Case candidates

Status: research note, 2026-09-02; candidate shortlist only, not accepted design

## Research identity and scope

Wordfenceの公開profileに表示されるresearcher名は正確には`daroo`である。URL末尾の`daroo-2`はprofile slugであり、別名または人物識別子とは扱わない。2026-09-02に確認したprofileはAll Time Discoveries 313件、All Time Ranking 22、90 Day Published Submissions 31件を表示し、SQLi、XSS、1337 Vulnerability Researcherのachievementも表示している。ただし、これらの値は更新されるlive metadataであり、固定評価値ではない。

- Primary identity source: [Wordfence Intelligence researcher profile — daroo](https://www.wordfence.com/threat-intel/vulnerabilities/researchers/daroo-2)
- Attribution rule: 下記Caseは各Wordfence vulnerability recordの`Researcher: daroo`を個別に確認したものだけを含む。
- Identity boundary: Wordfenceは、たとえばSimply Schedule AppointmentsのCVE-2026-3658を`momopon1415`へ、CVE-2026-39495を`daroo`へ別々に帰属している。公開一次資料で対応関係を確認できないため、このノートは`daroo`、`momopon1415`、会話中の人物を同一人物とは推定しない。

これは313件の完全inventoryではなく、Stored XSSとSQL injectionを中心に、公開sourceを取得でき、vulnerable/patched Boundary Pairを構成できる可能性が高いCaseを抽出したshortlistである。darooの公開portfolioは目標成果とmechanism coverageの参考であり、[3件のDesign references](../REFERENCES.md)へ追加する設計参照資料ではない。

## Recommended shortlist

### WPGraphQL SQL injection

- Public identity: CVE-2026-40762
- Versions: vulnerable positive `2.11.0`（Wordfenceのaffected rangeは`< 2.11.1`）、patched negative `2.11.1`
- Attacker premise: unauthenticated
- Public route-shape: GraphQLから渡るnon-numeric user loader keyがuser lookupへ入り、database query constructionへ到達する。これはWordfenceの一般的なSQLi説明に加え、vendorの2.11.1 release noteが「non-numeric user loader keysを拒否してSQL injectionを防ぐ」と明記しているため、公開情報として確認できる。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/wp-graphql/wpgraphql-2111-unauthenticated-sql-injection), [official WPGraphQL 2.11.1 release](https://github.com/wp-graphql/wp-graphql/releases/tag/wp-graphql%2Fv2.11.1), [official source repository](https://github.com/wp-graphql/wp-graphql)
- Recommended cohort role: **primary SQLi Development Boundary Pair**。公開source、明確なversion boundary、specificなsource-to-query routeを持ち、SQLi WitnessとCausal Controlを最初に型付けするのに最も適する。

### WP Statistics Stored XSS

- Public identity: CVE-2026-5231
- Versions: vulnerable positive `14.16.4`、patched negative `14.16.5`
- Attacker premise: unauthenticated visitor; administrator later opens the affected analytics view
- Public route-shape: requestの`utm_source` -> referral parser -> persistent `source_name` -> admin chart legendのDOM rendering。Wordfenceはwildcard channel matchと`innerHTML` renderingまで公開している。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/wp-statistics/wp-statistics-14164-unauthenticated-stored-cross-site-scripting-via-utm-source-parameter), [official source repository](https://github.com/wp-statistics/wp-statistics), [official changelog](https://github.com/wp-statistics/wp-statistics/blob/master/CHANGELOG.md)
- Recommended cohort role: **primary cross-request Stored XSS Development Boundary Pair**。HTTP input、PHP persistence、admin-side JavaScript consumerを跨ぐため、Surface Mapのserver/client relationとbrowser Witnessを同時に評価できる。

### TranslatePress Stored XSS

- Public identity: CVE-2026-76053
- Versions: vulnerable positive `3.3.3`、patched negative `3.3.4`
- Attacker premise: unauthenticated commenter; a user later views content processed during translation
- Public route-shape: WordPress KSESで許可されるcomment structure -> database persistence -> TranslatePress HTML parser -> translated page rendering。具体的payloadは評価入力へ含めない。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/translatepress-multilingual/translatepress-333-unauthenticated-stored-cross-site-scripting-via-comment-noise-key-injection-into-html-parser), [WordPress.org source and previous versions](https://wordpress.org/plugins/translatepress-multilingual/advanced/)
- Recommended cohort role: **held-out multi-stage Stored XSS Sealed Evaluation candidate**。allowlist、persistent comment、third-party parserというsemantic boundaryを跨ぎ、単純なsink searchだけでは不十分なCaseである。

### Customer Reviews for WooCommerce Stored XSS

- Public identity: CVE-2026-6176
- Versions: vulnerable positive `5.106.0`、patched negative `5.107.0`
- Attacker premise: unauthenticated user with a valid aggregated-review form URL; the URL is ordinarily available through a review reminder sent after an order
- Public route-shape: public AJAX review submission -> comment insertion -> product-page comment rendering。setupにはWooCommerce orderとreview-reminder lifecycleが必要になる。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/customer-reviews-woocommerce/customer-reviews-for-woocommerce-51060-unauthenticated-stored-cross-site-scripting-via-aggregated-review-form), [WordPress.org plugin source](https://wordpress.org/plugins/customer-reviews-woocommerce/)
- Recommended cohort role: **workflow-heavy Stored XSS Sealed Evaluation candidate**。form URLというattacker prerequisiteとcross-request persistenceを正しくモデル化できるかを測れるが、初期Setup Planとしては依存が重い。

### GiveWP Stored XSS

- Public identity: CVE-2026-5510
- Versions: vulnerable positive `4.14.4`、patched negative `4.14.5`
- Attacker premise: authenticated Contributor or higher who can save content containing the affected shortcode
- Public route-shape: shortcode attributes -> text-field sanitization -> unescaped HTML data-attribute context -> visitor rendering。入力sanitizationの存在だけで安全と判断せず、output contextまで追う必要がある。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/give/givewp-4144-authenticated-contributor-stored-cross-site-scripting-via-shortcode-attributes), [WordPress.org source and previous versions](https://wordpress.org/plugins/give/advanced/)
- Recommended cohort role: **focused output-context Stored XSS Development Boundary Pair**。低権限role、shortcode parse、HTML attribute sinkを小さなSetup Planで検証しやすい。

### Forminator rich-text Stored XSS

- Public identity: CVE-2026-18324
- Versions: vulnerable positive `1.57.0.1`、mechanism-patched negative `1.57.0.2`
- Attacker premise: unauthenticated form submitter; target form must have the Rich-Text editor option enabled
- Public route-shape: enabled rich-text textarea -> form submission persistence -> later page or entry rendering。Wordfenceが公開する根本原因はinsufficient input sanitization and output escapingであり、より細かなrouteはsource inspectionで確定する必要がある。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/forminator/forminator-forms-15701-unauthenticated-stored-cross-site-scripting-via-rich-text-textarea-field), [WordPress.org source and previous versions](https://wordpress.org/plugins/forminator/advanced/), [official tag comparison linked by Wordfence](https://plugins.trac.wordpress.org/changeset?new_path=%2Fforminator%2Ftags%2F1.57.0.2&old_path=%2Fforminator%2Ftags%2F1.57.0.1)
- Recommended cohort role: **configuration-sensitive Stored XSS Development Boundary Pair**。ただしWordfenceは1.57.0.2にも別のRadio Field Stored XSSを記録しているため、negativeは「pluginにXSSがない」ではなく「同じrich-text mechanismが成立しない」とだけ判定する。

### Simply Schedule Appointments SQL injection

- Public identity: CVE-2026-39495
- Versions: vulnerable positive `1.6.9.27`、patched negative `1.6.9.29`
- Attacker premise: authenticated Contributor or higher
- Public route-shape: low-privilege controlled input -> insufficiently escaped or prepared existing query -> database read impact。公開Wordfence recordは具体的parameterまたはentry pointを示していないため、それ以上のroute detailは`unknown`とする。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/simply-schedule-appointments/simply-schedule-appointments-16927-authenticated-contributor-sql-injection), [WordPress.org plugin source](https://wordpress.org/plugins/simply-schedule-appointments/)
- Recommended cohort role: **SQLi saturation/resolution reserve**。同じplugin/version帯に複数researcherの別SQLiが存在するため、Finderが別routeを発見した場合のdeduplication、causal identity、mechanism-specific negativeを試すには有用だが、最初のSQLi acceptanceには曖昧さが大きい。

### Product Filter for WooCommerce by WBW SQL injection

- Public identity: CVE-2026-39494
- Versions: vulnerable positive `3.1.2`、patched negative `3.1.3`
- Attacker premise: unauthenticated
- Public route-shape: unauthenticated plugin input -> insufficiently escaped or prepared query composition -> database information extraction。Wordfence recordは具体的parameterを公開していないため、entry pointは`unknown`とする。
- Sources: [Wordfence advisory](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/woo-product-filter/product-filter-for-woocommerce-by-wbw-312-unauthenticated-sql-injection), [Wordfence software record](https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/woo-product-filter)
- Recommended cohort role: **deferred SQLi reserve**。Wordfence software recordはpluginをRemovedとし、同じ3.1.3 boundaryに別researcherのSQLiも記録するため、snapshot provenanceとoracle判定を解消してから採用する。

## Selection recommendation

最初に追加する順序は次を推奨する。

1. WPGraphQL `2.11.0 / 2.11.1`: source-level causeがvendor releaseでも確認できる、最もcleanなSQLi pair。
2. WP Statistics `14.16.4 / 14.16.5`: PHP persistenceからadmin DOM consumerまで跨ぐStored XSS pair。
3. GiveWP `4.14.4 / 4.14.5`: output contextとlow-privilege premiseを小さく試せるStored XSS pair。
4. TranslatePress `3.3.3 / 3.3.4`: multi-stage parser routeをheld-outで測るhard Case。
5. Customer Reviews `5.106.0 / 5.107.0`: Setup PlanがWooCommerce lifecycleを安全に再現できた後のworkflow Case。

Forminatorは同一patched versionに別XSSが残ることを意図的に扱える段階、Simply Schedule AppointmentsとProduct Filterはcausal identityが同居Findingを分離できる段階までreserveとする。

## Oracle-blind use and admission checks

全Caseが公開済みであるため、これは未知脆弱性発見そのものの証明にはならず、modelのpretraining contaminationも排除できない。ここでいうoracle-blindは、FinderへCVE、affected/patched versionの意味、advisory、patch diff、上記route-shape、payload、expected file/functionを渡さないというharness上の隔離を意味する。

CaseをDevelopment CohortまたはSealed Evaluationへ昇格する前に、private workspaceで次を確認する。

- official archiveの取得可能性、content digest、safe manifest
- vulnerable/patched両Snapshotの同一Setup Planによる起動
- public advisoryを見ないhuman reproductionまたはindependent graderによるmechanism-specific Witness
- sibling Causal Controlとpatched-side negative
- target固有のoracleをproduction prompt、Surface Map、Knowledge、Git artifactへ混入させないこと
- patched negativeを「そのpluginに脆弱性がない」という一般命題へ拡張しないこと

この調査ノートはCase選定案であり、Module seam、runtime schema、accepted milestoneを変更しない。
