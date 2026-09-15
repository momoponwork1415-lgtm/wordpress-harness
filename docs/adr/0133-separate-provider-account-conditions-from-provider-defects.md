---
status: accepted
---

# Separate provider account conditions from provider defects

Native Run失敗Receiptで、provider accountの状態とprovider defectを別のterminalへ分ける。5時間枠等のusage limitを示すHTTP 429 envelopeは`provider-quota-exhausted`、model workが一度も発生しないままproviderへ認証できなかった失敗は`provider-unauthenticated`として記録する。Harness自身のwall-time / run budgetとproviderのbudget error envelopeは従来どおり`budget-exhausted`に残す。

Account conditionはstatus codeだけから推測せず、provider固有のadmit済みerror envelopeとusage observationから判定する。通常のrate-limit / overloadをusage-limitへ丸めない。現時点でこの分類を実測・実装するのはClaude Code / GLM Adapterであり、Grok / Codex Adapterは対応するprovider-native error envelopeをprobeするまで`provider-failed`を維持する。

`provider-unauthenticated`はAgentがmodel workを行っていないため`retryable: true`を付け、同じsealed Grantを人間のReviewなしに通常の再実行で一度だけ再試行できる。`provider-quota-exhausted`にはretryable markerを付けず、有効なAgent Checkpointを残した場合だけ通常の再実行でそのdurable stateから一度だけresumeする。再試行も失敗した場合は追加の通常実行を開始しない。resetまでの待機はHarnessのdomain stateにしない。providerのreset表記にはUTC offsetがなく、typedなinstantとして保存すると推測になるため、reset時刻はprivate Agent Run Diagnosticの中だけに残し、いつ再投入するかはbatch launcherと人間が決める。

これによりResearch Recordだけから「providerが完了しなかった」「枠を使い切った」「認証できていない」を区別でき、枠が閉じているlaneへの再投入と、認証切れで消費されたGrantの取り違えを防げる。代償として失敗terminalが二つ増え、terminalを網羅するcodeとdocumentの更新が必要になる。
