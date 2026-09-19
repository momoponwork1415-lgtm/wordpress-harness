---
status: accepted
---

# domain上の意味を統合せずprivate artifact storageを共有する

ResearchのAgent Checkpoint、Agent Run Diagnostic、Native Run Receipt recovery capsule、Candidate Verification Recipeは、一つのPrivate Artifact Store implementationで保存する。各artifactが個別に`mkdir`、temporary path、rename、digest検査、link検査とconflict処理を実装すると、安全規則が経路ごとにずれ、追加artifactのたびに同じfilesystem判断を複製するためである。

Storeはartifact identityごとにversioned manifestとboundedなcanonical content treeを持ち、store root内のstagingからatomicにpromoteする。resolveとbounded file readはmissing、integrity mismatch、size limit、unsafe pathを区別し、conflictまたはabandoned stagingを自動repair・上書き・削除しない。unsafeなstate treeをDiagnosticへ含められない場合はDiagnostic全体を失わず、redacted process evidenceだけを`statePreserved: false`として保存する。

共通化するのはfilesystem implementationだけである。Checkpointのstate digestとsession binding、DiagnosticのJSON digestとbyte count、Receiptのrun / runtime binding、RecipeのCandidate / Target bindingは各domain Adapterが所有し続け、共通manifestをhandoff contractにしない。代償として既存artifactの内部physical layoutはmanifestと`content` directoryを持つ形式へ変わるが、公開refのschemaと意味は変更しない。
