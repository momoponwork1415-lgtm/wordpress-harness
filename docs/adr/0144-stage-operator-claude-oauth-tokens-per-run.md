---
status: accepted
---

# operatorが取得したClaude OAuth tokenをrunごとに一時配置する

非対話のClaude Researchでは、利用者が`claude setup-token`で取得した長期OAuth tokenを、owner-onlyな`<provider-config>/claude-oauth-token`へ置く。Harnessはこのtokenをrun-localなprovider homeの`settings.json`へだけ配置し、Claude Codeの`CLAUDE_CODE_OAUTH_TOKEN`として使う。Research Agentのsubprocessからcredential環境を除き、login / logout commandを無効にする。終了時はCheckpoint確定より前にsettingsを削除し、token値をcommand argv、Receipt、Diagnostic、Checkpoint、Gitへ残さない。Native Run Receiptにはtoken値ではなく、operator tokenを一時配置して削除した事実だけを自己digest付きで記録する。

隔離run内でClaude Codeが更新した`.credentials.json`をoperatorのcredential sourceへコピーし戻さない。対象ソースを扱うResearch Agentが書ける場所をcredentialの正本に昇格させると、prompt injectionやprovider processの侵害を次のCampaignの権限へ持ち越すためである。[AnthropicのAuthentication文書](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)も、非対話のCIやscriptには`claude setup-token`と`CLAUDE_CODE_OAUTH_TOKEN`を案内している。

互換のため、operator tokenがない場合は既存のrun-local `.credentials.json` copyを当面維持する。このlegacy loginが失効した場合は、更新可能性を非公開file形式から推測せず`provider-unauthenticated`として止め、人間へsetup-tokenの再取得を要求する。代償としてtokenには一年ごとの更新が必要だが、人間がcredentialを取得する境界、Agentの権限、失敗の意味が明確になる。
